/* eslint-disable no-undef */
import * as MP4Box from 'mp4box';

/**
 * Taken from https://github.com/w3c/webcodecs/blob/main/samples/mp4-decode/mp4_demuxer.js
 */
class Writer {
  constructor(size) {
    this.data = new Uint8Array(size);
    this.idx = 0;
    this.size = size;
  }

  getData() {
    if (this.idx !== this.size)
      throw new Error('Mismatch between size reserved and sized used');
    return this.data.slice(0, this.idx);
  }

  writeUint8(value) {
    this.data.set([value], this.idx);
    this.idx += 1;
  }

  writeUint16(value) {
    const arr = new Uint16Array(1);
    arr[0] = value;
    const buffer = new Uint8Array(arr.buffer);
    this.data.set([buffer[1], buffer[0]], this.idx);
    this.idx += 2;
  }

  writeUint8Array(value) {
    this.data.set(value, this.idx);
    this.idx += value.length;
  }
}

/**
 * Taken from https://github.com/w3c/webcodecs/blob/main/samples/mp4-decode/mp4_demuxer.js
 *
 * @param avccBox
 * @returns {*}
 */
const getExtradata = (avccBox) => {
  let i;
  let size = 7;
  for (i = 0; i < avccBox.SPS.length; i += 1) {
    // nalu length is encoded as a uint16.
    size += 2 + avccBox.SPS[i].length;
  }
  for (i = 0; i < avccBox.PPS.length; i += 1) {
    // nalu length is encoded as a uint16.
    size += 2 + avccBox.PPS[i].length;
  }

  const writer = new Writer(size);

  writer.writeUint8(avccBox.configurationVersion);
  writer.writeUint8(avccBox.AVCProfileIndication);
  writer.writeUint8(avccBox.profile_compatibility);
  writer.writeUint8(avccBox.AVCLevelIndication);
  // eslint-disable-next-line no-bitwise
  writer.writeUint8(avccBox.lengthSizeMinusOne + (63 << 2));

  // eslint-disable-next-line no-bitwise
  writer.writeUint8(avccBox.nb_SPS_nalus + (7 << 5));
  for (i = 0; i < avccBox.SPS.length; i += 1) {
    writer.writeUint16(avccBox.SPS[i].length);
    writer.writeUint8Array(avccBox.SPS[i].nalu);
  }

  writer.writeUint8(avccBox.nb_PPS_nalus);
  for (i = 0; i < avccBox.PPS.length; i += 1) {
    writer.writeUint16(avccBox.PPS[i].length);
    writer.writeUint8Array(avccBox.PPS[i].nalu);
  }

  return writer.getData();
};

/**
 * decodeVideo takes an url to a mp4 file and converts it into frames.
 *
 * The steps for this are:
 *  1. Determine the codec for this video file and demux it into chunks.
 *  2. Read the chunks with VideoDecoder as fast as possible.
 *  3. Return an array of frames that we can efficiently draw to a canvas.
 *
 * @param src
 * @param VideoDecoder
 * @param EncodedVideoChunk
 * @param emitFrame
 * @param debug
 * @returns {Promise<unknown>}
 */
const decodeVideo = (
  src,
  emitFrame,
  { VideoDecoder, EncodedVideoChunk, debug },
) =>
  new Promise((resolve, reject) => {
    if (debug) console.info('Decoding video from', src);

    try {
      // Uses mp4box for demuxing
      const mp4boxfile = MP4Box.createFile();

      // Holds the codec value
      let codec;

      // Creates a VideoDecoder instance
      const decoder = new VideoDecoder({
        output: (frame) => {
          createImageBitmap(frame).then((bitmap) => {
            emitFrame(bitmap);
            frame.close();

            if (decoder.decodeQueueSize <= 0) {
              // Give it an extra half second to finish everything
              setTimeout(() => {
                if (decoder.state !== 'closed') {
                  decoder.close();
                  resolve();
                }
              }, 500);
            }
          });
        },
        error: (e) => {
          // eslint-disable-next-line no-console
          console.error(e);
          reject(e);
        },
      });

      mp4boxfile.onReady = (info) => {
        if (info && info.videoTracks && info.videoTracks[0]) {
          [{ codec }] = info.videoTracks;
          if (debug) console.info('Video with codec:', codec);

          // Gets the avccbox used for reading extradata
          const avccBox =
            mp4boxfile.moov.traks[0].mdia.minf.stbl.stsd.entries[0].avcC;
          const extradata = getExtradata(avccBox);

          // configure decoder
          decoder.configure({ codec, description: extradata });

          // Setup mp4box file for breaking it into chunks
          mp4boxfile.setExtractionOptions(info.videoTracks[0].id);
          mp4boxfile.start();
        } else reject(new Error('URL provided is not a valid mp4 video file.'));
      };

      mp4boxfile.onSamples = (track_id, ref, samples) => {
        for (let i = 0; i < samples.length; i += 1) {
          const sample = samples[i];
          const type = sample.is_sync ? 'key' : 'delta';

          const chunk = new EncodedVideoChunk({
            type,
            timestamp: sample.cts,
            duration: sample.duration,
            data: sample.data,
          });

          decoder.decode(chunk);
        }
      };

      // Fetches the file into arraybuffers
      fetch(src).then((res) => {
        const reader = res.body.getReader();
        let offset = 0;

        function appendBuffers({ done, value }) {
          if (done) {
            mp4boxfile.flush();
            return null;
          }

          const buf = value.buffer;
          buf.fileStart = offset;
          offset += buf.byteLength;
          mp4boxfile.appendBuffer(buf);

          return reader.read().then(appendBuffers);
        }

        return reader.read().then(appendBuffers);
      });
    } catch (e) {
      reject(e);
    }
  });

/**
 * The main function for decoding video. Deals with the polyfill cases first,
 * then calls our decodeVideo.
 *
 * @param src
 * @param emitFrame
 * @param debug
 * @returns {Promise<never>|Promise<void>|*}
 */
export default (src, emitFrame, debug) => {};

/** @type ImageBitmap[] */
let frames = [];
/** @type OffscreenCanvas */
let canvas;
/** @type ImageBitmapRenderingContext */
let context;
/** @type number */
let duration;
/** @type number */
let frameRate;
// initialize using -1, so we don't write an empty image into the frames array
let lastFrame = -1;
let currentTime = 0;
let targetTime = 0;
let transitioningRaf = null;
const frameThreshold = 0.05;

/**
 * Process the video and extract all the images
 *
 * @param {string} src
 * @param {boolean} [debug=false]
 * @returns {Promise<void>}
 */
function processVideoSrc(src, debug = false) {
  // If our browser supports WebCodecs natively
  if (
    typeof VideoDecoder === 'function' &&
    typeof EncodedVideoChunk === 'function'
  ) {
    if (debug)
      console.info('WebCodecs is natively supported, using native version...');

    return decodeVideo(
      src,
      (frame) => {
        frames.push(frame);
      },
      {
        VideoDecoder,
        EncodedVideoChunk,
        debug,
      },
    )
      .then(() => {
        // If no frames, something went wrong
        if (frames.length === 0) {
          throw new Error('No frames were received from webCodecs');
        }
        if (debug) console.info('Decoding successfully.');
        self.postMessage({ message: 'DECODING_SUCCESS' });
      })
      .catch((err) => {
        if (frames.length > 0) {
          frames.forEach((frame) => {
            frame.close();
          });
        }

        frames = [];

        if (debug) console.error('Decoding was not successful.', err);
				throw err;
      });
  }

  // Otherwise, resolve nothing
  if (debug) console.info('WebCodecs is not available in this browser.');
	throw new Error('WebCodecs is not available in this browser.');
}

/**
 * Paint the desired frame to the canvas
 * @param frameNum
 * @param debug
 */
function paintCanvasFrame(frameNum, debug = false, force = false) {
  // Skip if same frame is being drawn
  if (!force && frameNum === lastFrame) {
    return;
  }

  // clamp frameNumber
  frameNum = Math.min(Math.max(0, frameNum), frames.length - 1);

  // Get the frame and paint it to the canvas
  const currFrame = frames[frameNum];

  if (!canvas || !currFrame || !context) {
    return;
  }

  // save the current frame back
  if (lastFrame >= 0) frames[lastFrame] = canvas.transferToImageBitmap();

  if (debug) {
    console.debug('Painting frame', frameNum);
  }

  canvas.height = currFrame.height;
  canvas.width = currFrame.width;

  // Draw the frame to the canvas context
  context.transferFromImageBitmap(currFrame);

  // Update frame cache
  lastFrame = frameNum;
}

function transitionToTargetTime(options, debug = false) {
  const { transitionSpeed, jump, easing = (x) => x } = options;

  if (Number.isNaN(targetTime)) return;

  const diff = targetTime - currentTime;
  const distance = Math.abs(diff);
  const distanceInMs = distance * 1000; // convert to milliseconds
  const isForwardTransition = diff > 0;
  const directionFactor = isForwardTransition ? 1 : -1;

  // synchronise current time with main thread
  self.postMessage({ message: 'CURRENT_TIME', currentTime });

  /**
   * Save the animation frame timestamp to calculate the deltaTime (and with that the browser's
   * framerate). In Milliseconds.
   * @type {number}
   */
  let previousAnimationFrameTimestamp;

  /**
   * Here is the main loop of the transition animation
   *
   * @param {Object} opts
   * @param {number} opts.startCurrentTime - Where the video is at when the transition starts; in
   *   seconds.
   * @param {number} opts.startTimestamp - The timestamp of the first animation frame that was
   *   requested, helps to keep track how long the animation is running; in milliseconds.
   * @param {number} opts.timestamp - The timestamp of the current animation frame, in milliseconds
   */
  const tick = ({ startCurrentTime, startTimestamp, timestamp }) => {
    // if frameThreshold is too low to catch condition Math.abs(targetTime - currentTime) < this.frameThreshold
    const hasPassedThreshold = isForwardTransition
      ? currentTime >= targetTime
      : currentTime <= targetTime;

    // If we are already close enough to our target, pause the video and return.
    // This is the base case of the recursive function
    if (
      // eslint-disable-next-line no-restricted-globals
      Number.isNaN(targetTime) ||
      // If the currentTime is already close enough to the targetTime
      Math.abs(targetTime - currentTime) < frameThreshold ||
      hasPassedThreshold
    ) {
      if (transitioningRaf) {
        // eslint-disable-next-line no-undef
        cancelAnimationFrame(transitioningRaf);
        transitioningRaf = null;
      }
      self.postMessage({ message: 'CURRENT_TIME', currentTime });

      return;
    }

    // Make sure we don't go out of time bounds
    targetTime = Math.min(Math.max(0, targetTime), duration);

    /**
     * How long the last frame took to render.
     * The assumption is that the next will take about the same amount of time.
     * Modern browsers will attempt to keep a framerate of 60 fps;
     * this means this number should be ~16.6666.
     *
     * @type {number}
     */
    const deltaTime = timestamp - previousAnimationFrameTimestamp;

    // Before we do all the calculations, handle the simple case first: jumping to a timestamp
    if (jump) {
      // When jumping, we go directly to the frame
      currentTime = targetTime;
      paintCanvasFrame(Math.floor(currentTime * frameRate), debug);
    } else if (transitionSpeed === 0) {
      // Use the native timing of the video
      // Works best with animated videos;
      // using the native speed assures that the original easings are respected.

      // Add the deltaTime to the currentTime
      currentTime += deltaTime * 0.001 * directionFactor;
      paintCanvasFrame(Math.floor(currentTime * frameRate), debug);
    } else {
      // Use a fixed amount of time for the transition to the desired frame
      // You may use an easing function for this.
      // The default easing function is linear.

      /**
       * Calculate how far along the transition we should be.
       * Depends on the {@link startTimestamp} and {@link transitionSpeed}.
       *
       * @param {number} ts - The timestamp of the current animation frame, in milliseconds
       * @returns {number} - The current progress, as a number between 0 and 1.
       */
      const getProgressAtTimestamp = (ts) =>
        (ts - startTimestamp) / transitionSpeed;

      /** How far along the transition we are timewise */
      const progress = getProgressAtTimestamp(timestamp);

      /** How far the transition should be, taking easing into account */
      const easedProgress =
        easing && Number.isFinite(progress) ? easing(progress) : progress;

      // Calculate desired currentTime; multiply with 0.001 since this one is in seconds
      currentTime =
        startCurrentTime +
        easedProgress * distanceInMs * directionFactor * 0.001;
      paintCanvasFrame(Math.floor(currentTime * frameRate), debug);
    }

    // Recursively calls ourselves until the animation is done.
    previousAnimationFrameTimestamp = timestamp;
    if (typeof requestAnimationFrame === 'function') {
      // eslint-disable-next-line no-undef
      transitioningRaf = requestAnimationFrame((currentTimestamp) =>
        tick({
          startCurrentTime,
          startTimestamp,
          timestamp: currentTimestamp,
        }),
      );
    }
  };

  if (typeof requestAnimationFrame === 'function') {
    // eslint-disable-next-line no-undef
    transitioningRaf = requestAnimationFrame((startTimestamp) => {
      previousAnimationFrameTimestamp = startTimestamp;
      tick({
        startCurrentTime: currentTime,
        startTimestamp,
        timestamp: startTimestamp,
      });
    });
  }
}

self.onmessage = (event) => {
  const { message, debug } = event.data;

  if (debug) console.debug('Worker received Message: ', message, event.data);

  switch (message) {
    case 'REQUEST_DECODE':
      const { src } = event.data;
      processVideoSrc(src, frames, debug);
      break;

    case 'SETUP_CANVAS':
      try {
        const { canvas: passedCanvas, duration: passedDuration } = event.data;
        canvas = passedCanvas;
        context = canvas.getContext('bitmaprenderer');
        duration = passedDuration;
        frameRate = frames.length / duration;
        // paint first frame to get at least something
        transitioningRaf = requestAnimationFrame(() => {
          paintCanvasFrame(1, debug, true);
        });
      } catch (e) {
        if (debug) console.error('Setting up canvas failed.', e);
      }
      self.postMessage({ message: 'CANVAS_CREATED' });
      break;

    case 'PAINT_CURRENT_TIME':
      const { currentTime: passedCurrentTime } = event.data;
      currentTime = passedCurrentTime;
      transitioningRaf = requestAnimationFrame(() => {
        paintCanvasFrame(Math.floor(currentTime * frameRate), debug);
      });
      break;

    case 'PAINT_FRAME':
      const { frame } = event.data;
      transitioningRaf = requestAnimationFrame(() => {
        paintCanvasFrame(frame, debug, true);
      });
      break;

    case 'REQUEST_TRANSITION':
      cancelAnimationFrame(transitioningRaf);
      const { targetTime: passedTargetTime, options } = event.data;
      targetTime = passedTargetTime;
      transitionToTargetTime(options, debug);
      break;

    case 'GET_CURRENT_TIME':
      self.postMessage({ message: 'CURRENT_TIME', currentTime });
      break;

    default:
      if (debug) console.info('Message was not be processed.', message);
  }
};
