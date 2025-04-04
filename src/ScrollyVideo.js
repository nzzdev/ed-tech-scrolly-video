import UAParser from 'ua-parser-js';
import videoDecoder from './videoDecoder';
import { debounce, isScrollPositionAtTarget } from './utils';

/**
 *   ____                 _ _     __     ___     _
 *  / ___|  ___ _ __ ___ | | |_   \ \   / (_) __| | ___  ___
 *  \___ \ / __| '__/ _ \| | | | | \ \ / /| |/ _` |/ _ \/ _ \
 *   ___) | (__| | | (_) | | | |_| |\ V / | | (_| |  __/ (_) |
 *  |____/ \___|_|  \___/|_|_|\__, | \_/  |_|\__,_|\___|\___/
 *                            |___/
 *
 * Responsive scrollable videos without obscure video encoding requirements.
 * Compatible with React, Svelte, Vue, and plain HTML.
 */
class ScrollyVideo {
  constructor({
    src, // The src of the video, required
    scrollyVideoContainer, // The dom element or id that this object will be created in, required
    objectFit = 'contain', // Whether the video should "cover" inside the container
    sticky = true, // Whether the video should "stick" to the top of the container
    trackScroll = true, // Whether this object should automatically respond to scroll
    lockScroll = true, // Whether it ignores human scroll while it runs `setVideoPercentage` with enabled `trackScroll`
    transitionSpeed = 8, // How fast the video transitions between points
    frameThreshold = 0.001, // When to stop the video animation, in seconds
    useWebCodecs = true, // Whether to try using the webcodecs approach
    onReady = () => {}, // A callback that invokes on video decode
    onChange = () => {}, // A callback that invokes on video percentage change
    debug = false, // Whether to print debug stats to the console
  }) {
    // Make sure that we have a DOM
    if (typeof document !== 'object') {
      console.error('ScrollyVideo must be initiated in a DOM context');
      return;
    }

    // Make sure the basic arguments are set for scrollyvideo
    if (!scrollyVideoContainer) {
      console.error('scrollyVideoContainer must be a valid DOM object');
      return;
    }
    if (!src) {
      console.error('Must provide valid video src to ScrollyVideo');
      return;
    }

    // Save the container. If the container is a string we get the element
    // eslint-disable-next-line no-undef
    if (scrollyVideoContainer instanceof Element)
      this.container = scrollyVideoContainer;
    // otherwise it should better be an element
    else if (typeof scrollyVideoContainer === 'string') {
      // eslint-disable-next-line no-undef
      this.container = document.getElementById(scrollyVideoContainer);
      if (!this.container)
        throw new Error('scrollyVideoContainer must be a valid DOM object');
    } else {
      throw new Error('scrollyVideoContainer must be a valid DOM object');
    }

    // Save the constructor options
    this.src = src;
    this.transitionSpeed = transitionSpeed;
    this.frameThreshold = frameThreshold;
    this.useWebCodecs = useWebCodecs;
    this.objectFit = objectFit;
    this.sticky = sticky;
    this.trackScroll = trackScroll;
    this.onReady = onReady;
    this.onChange = onChange;
    this.debug = debug;

    // Create the initial video object. Even if we are going to use webcodecs,
    // we start with a paused video object
    // eslint-disable-next-line no-undef
    this.video = document.createElement('video');
    this.video.src = src;
    this.video.preload = 'auto';
    this.video.tabIndex = 0;
    this.video.autobuffer = true;
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.pause();
    this.video.load();

    // Adds the video to the container
    this.layoutContainer = document.createElement('div');
    this.layoutContainer.classList.add('scrollyvideo-layout-container');
    this.layoutContainer.style.display = 'flex';
    this.layoutContainer.style.justifyContent = 'center';
    this.layoutContainer.style.width = '100%';
    this.layoutContainer.style.height = '100vh';

    this.container.appendChild(this.layoutContainer);

    this.layoutContainer.appendChild(this.video);
    this.cavnasContainer = document.createElement('div');
    this.layoutContainer.appendChild(this.cavnasContainer);

    // Setting CSS properties for container
    this.container.classList.add('scrollyvideo-container');
    this.container.style.display = 'block';
    this.container.style.position = 'sticky';
    this.container.style.top = '0';
    this.container.style.width = '100%';
    this.container.style.height = '100vh';
    this.container.style.overflow = 'hidden';

    // Setting CSS properties for cover
    this.setCoverStyle(this.video);
    this.videoDimensions = this.video.getBoundingClientRect();

    // Detect webkit (safari), because webkit requires special attention
    const browserEngine = new UAParser().getEngine();
    // eslint-disable-next-line no-undef
    this.isSafari = browserEngine.name === 'WebKit';
    if (debug && this.isSafari) console.info('Safari browser detected');

    // Initialize state variables
    this.currentTime = 0; // Saves the currentTime of the video, synced with this.video.currentTime
    this.targetTime = 0; // The target time before a transition happens
    this.canvas = null; // The canvas for drawing the frames decoded by webCodecs
    this.context = null; // The canvas context
    this.frames = []; // The frames decoded by webCodecs
    this.frameRate = 0; // Calculation of frameRate so we know which frame to paint

    const debouncedScroll = debounce(() => {
      // eslint-disable-next-line no-undef
      window.requestAnimationFrame(() => {
        this.setScrollPercent(this.videoPercentage);
      });
    }, 100);

    // Add scroll listener for responding to scroll position
    this.updateScrollPercentage = (jump) => {
      // Used for internally setting the scroll percentage based on built-in listeners
      const containerBoundingClientRect =
        this.container.parentNode.getBoundingClientRect();

      // Calculate the current scroll percent of the video
      const scrollPercent =
        -containerBoundingClientRect.top /
        // eslint-disable-next-line no-undef
        (containerBoundingClientRect.height - window.innerHeight);

      if (this.debug) {
        console.info('ScrollyVideo scrolled to', scrollPercent);
      }

      if (this.targetScrollPosition == null) {
        this.setTargetTimePercent(scrollPercent, { jump });
        this.onChange(scrollPercent);
      } else if (isScrollPositionAtTarget(this.targetScrollPosition)) {
        this.targetScrollPosition = null;
      } else if (lockScroll && this.targetScrollPosition != null) {
        debouncedScroll();
      }
    };

    // Add our event listeners for handling changes to the window or scroll
    if (this.trackScroll) {
      // eslint-disable-next-line no-undef
      window.addEventListener('scroll', this.updateScrollPercentage);

      // Set the initial scroll percentage
      this.video.addEventListener(
        'loadedmetadata',
        () => this.updateScrollPercentage(true),
        { once: true },
      );
    } else {
      this.video.addEventListener(
        'loadedmetadata',
        () => this.setTargetTimePercent(0, { jump: true }),
        { once: true },
      );
    }

    // Add resize function
    this.resize = (width) => {
      if (this.debug) console.info('ScrollyVideo resizing...');
      // On resize, we need to reset the cover style
      this.setCoverStyle(this.video);

      // Calculate height maintaining aspect ratio
      // const aspectRatio = this.video.videoHeight / this.video.videoWidth;
      // const height = width * aspectRatio;

      // this.videoDimensions = { width, height };
      // Then repaint the canvas, if we are in useWebcodecs
      if (this.canvas) {
        this.paintCanvasFrame(
          Math.floor(this.currentTime * this.frameRate),
          width,
        );
      }
    };

    // eslint-disable-next-line no-undef
    window.addEventListener('resize', this.resize);
    this.video.addEventListener('progress', this.resize);

    // Calls decode video to attempt webcodecs method
    this.decodeVideo();
  }

  /**
   * Sets the currentTime of the video as a specified percentage of its total duration.
   *
   * Public entry point to directly manipulate the video position.
   *
   * @param percentage - The percentage of the video duration to set as the current time.
   * @param options - Configuration options for adjusting the video playback.
   *    - jump: boolean - If true, the video currentTime will jump directly to the specified
   *   percentage. If false, the change will be animated over time.
   *    - transitionSpeed: number - Defines the speed of the transition when `jump` is false.
   *   Represents the duration of the transition in milliseconds. Default is 8.
   *    - easing: (progress: number) => number - A function that defines the easing curve for the
   *   transition. It takes the progress ratio (a number between 0 and 1) as an argument and
   *   returns the eased value, affecting the playback speed during the transition.
   */
  setVideoPercentage(percentage, options = {}) {
    if (this.transitioningRaf) {
      // eslint-disable-next-line no-undef
      window.cancelAnimationFrame(this.transitioningRaf);
    }

    this.videoPercentage = percentage;

    this.onChange(percentage);

    if (this.trackScroll) {
      this.setScrollPercent(percentage);
    }

    this.setTargetTimePercent(percentage, options);
  }

  /**
   * Sets the style of the video or canvas to "cover" it's container
   *
   * @param el
   */
  setCoverStyle(el) {
    el.style.width = '100%';
    el.style.objectFit = this.objectFit;
  }

  /**
   * Uses webCodecs to decode the video into frames
   */
  async decodeVideo() {
    if (!this.useWebCodecs) {
      if (this.debug)
        console.warn('Cannot perform video decode: `useWebCodes` disabled');

      return;
    }

    if (!this.src) {
      if (this.debug)
        console.warn('Cannot perform video decode: no `src` found');

      return;
    }

    try {
      await videoDecoder(
        this.src,
        (frame) => {
          this.frames.push(frame);
        },
        this.debug,
      );
    } catch (error) {
      if (this.debug)
        console.error('Error encountered while decoding video', error);

      // Remove all decoded frames if a failure happens during decoding
      this.frames = [];

      // Force a video reload when videoDecoder fails
      this.video.load();
    }

    // If no frames, something went wrong
    if (this.frames.length === 0) {
      if (this.debug) console.error('No frames were received from webCodecs');

      this.onReady();
      return;
    }

    // Calculate the frameRate based on number of frames and the duration
    this.frameRate = this.frames.length / this.video.duration;
    if (this.debug) console.info('Received', this.frames.length, 'frames');
    // Remove the video and add the canvas
    // eslint-disable-next-line no-undef
    this.canvas = document.createElement('canvas');

    this.context = this.canvas.getContext('2d', { alpha: false });

    // Hide the video and add the canvas to the container
    this.video.style.display = 'none';
    this.cavnasContainer.appendChild(this.canvas);

    // Initialize frame cache
    this.lastDrawnFrame = null;
    this.lastDrawnFrameNum = -1;

    // Paint our first frame
    this.paintCanvasFrame(Math.floor(this.currentTime * this.frameRate));

    this.onReady();
  }

  /**
   * Paints the frame of to the canvas
   *
   * @param frameNum
   */
  paintCanvasFrame(frameNum, pwidth) {
    // Skip if same frame is being drawn
    if (frameNum === this.lastDrawnFrameNum) {
      return;
    }

    // Get the frame and paint it to the canvas
    const currFrame = this.frames[frameNum];

    if (!this.canvas || !currFrame) {
      return;
    }

    if (this.debug) {
      console.info('Painting frame', frameNum);
    }

    // Make sure the canvas is scaled properly, similar to setCoverStyle
    const { width, height } = this.videoDimensions;

    this.canvas.width = currFrame.width;
    this.canvas.height = currFrame.height;

    if (this.objectFit === 'cover') {
      // Set canvas display size
      this.canvas.style.width = `${pwidth}px`;
      this.canvas.style.height = `${height}px`;
      this.layoutContainer.style.alignItems = 'unset';
    } else {
      this.canvas.style.width = `100%`;
      this.layoutContainer.style.alignItems = 'center';
    }
    this.canvas.style.objectFit = this.objectFit;

    // Clear previous frame

    // Draw the frame to the canvas context
    this.context.drawImage(currFrame, 0, 0, currFrame.width, currFrame.height);

    // Update frame cache
    this.lastDrawnFrameNum = frameNum;
  }

  /**
   * Transitions the video or the canvas to the proper frame.
   *
   * @param {Object} options - Configuration options for adjusting the video playback.
   * @param {boolean} options.jump - If true, the video currentTime will jump
   *   directly to the specified percentage. If false, the change will be animated over time.
   * @param {number} options.transitionSpeed - Defines the speed of the transition when `jump` is false.
   *   Represents the duration of the transition in milliseconds. Default is 8. Use 0 to use the
   *   native speed of the video.
   * @param {(progress: number) => number} options.easing - A function that defines the easing curve for the
   *   transition. It takes the progress ratio (a number between 0 and 1) as an argument and
   *   returns the eased value, affecting the playback speed during the transition.
   */
  transitionToTargetTime({
    jump,
    transitionSpeed = this.transitionSpeed,
    easing = (x) => x,
  }) {
    if (this.debug) {
      console.table({
        transitionSpeed,
        easing,
        jump,
        currentTime: this.currentTime,
        targetTime: this.targetTime,
      });
    }

    const diff = this.targetTime - this.currentTime;
    const distance = Math.abs(diff);
    const duration = distance * 1000; // convert to milliseconds
    const isForwardTransition = diff > 0;
    const directionFactor = isForwardTransition ? 1 : -1;

    // Save the animation frame timestamp to calculate the deltaTime (and with that the browser's framerate)
    let previousAnimationFrameTimestamp;

    /**
     * This is what happens in each frame.
     *
     * @param startCurrentTime
     * @param startTimestamp
     * @param timestamp
     */
    const tick = ({ startCurrentTime, startTimestamp, timestamp }) => {
      // if frameThreshold is too low to catch condition Math.abs(this.targetTime - this.currentTime) < this.frameThreshold
      const hasPassedThreshold = isForwardTransition
        ? this.currentTime >= this.targetTime
        : this.currentTime <= this.targetTime;

      // If we are already close enough to our target, pause the video and return.
      // This is the base case of the recursive function
      if (
        // eslint-disable-next-line no-restricted-globals
        isNaN(this.targetTime) ||
        // If the currentTime is already close enough to the targetTime
        Math.abs(this.targetTime - this.currentTime) < this.frameThreshold ||
        hasPassedThreshold
      ) {
        this.video.pause();

        if (this.transitioningRaf) {
          // eslint-disable-next-line no-undef
          cancelAnimationFrame(this.transitioningRaf);
          this.transitioningRaf = null;
        }

        return;
      }

      // Make sure we don't go out of time bounds
      if (this.targetTime > this.video.duration)
        this.targetTime = this.video.duration;
      if (this.targetTime < 0) this.targetTime = 0;

      /**
       * How long the last frame took to render.
       * The assumption is that the next will take about the same
       */
      const deltaTime = timestamp - previousAnimationFrameTimestamp;
      const browserFramerate = 1000 / deltaTime;

      // Before we do all the calculations, handle the simple case first: jumping to a timestamp
      if (jump) {
        // When jumping, we go directly to the frame
        this.currentTime = this.targetTime;

        if (this.canvas) {
          // Canvas Mode
          this.paintCanvasFrame(Math.floor(this.currentTime * this.frameRate));
        } else {
          // Video Mode
          this.video.pause();
          this.video.currentTime = this.currentTime;
        }
      } else if (transitionSpeed === 0) {
        // Use the native timing of the video
        // Works best with animated videos;
        // using the native speed assures that the original easings are respected.

        // Add the deltaTime to the currentTime
        this.currentTime += (deltaTime / 1000) * directionFactor;
        if (this.canvas) {
          this.paintCanvasFrame(Math.floor(this.currentTime * this.frameRate));
        } else if (isForwardTransition) {
          // Video Mode
          this.video.play(); // Set video to playing
          this.currentTime = this.video.currentTime;
          // --> go to the next animation frame, check if currentTime === targetTime, stop
        } else {
          // We're going backward!
          // We can't use a negative playbackRate, so if the video needs to go backwards,
          // We have to use the inefficient method of modifying currentTime rapidly to
          // get an effect.
          this.video.pause();
          this.video.currentTime = this.currentTime;
          // --> go to the next animation frame
        }
      } else {
        // Use a fixed amount of time for the transition to the desired frame
        // You may use an easing function for this.
        // The default easing function is linear.

        /** Progress of the animation, in milliseconds */
        const getProgressAtTimestamp = (ts) =>
          (ts - startTimestamp) / transitionSpeed;
        const progress = getProgressAtTimestamp(timestamp);

        const easedProgress =
          easing && Number.isFinite(progress) ? easing(progress) : progress;
        this.currentTime += easedProgress * directionFactor;

        if (this.canvas) {
          this.paintCanvasFrame(Math.floor(this.currentTime * this.frameRate));
        } else if (this.isSafari || !isForwardTransition) {
          // We can't use a negative playbackRate, so if the video needs to go backwards,
          // We have to use the inefficient method of modifying currentTime rapidly to
          // get an effect.
          this.video.pause();
          this.video.currentTime = this.currentTime;
        } else {
          // Otherwise, we play the video and adjust the playbackRate to get a smoother
          // animation effect.

          /**
           * The base speed for the linear case: how fast we have to play
           * the video so that we can fit the duration within the desired
           * transition speed.
           */
          const basePlaybackRate = duration / transitionSpeed;

          // Calculate the velocity for the next frame.
          // This way we know whether we have to go faster or slower in relation to the base speed.
          const progressDistance =
            getProgressAtTimestamp(timestamp + deltaTime) -
            getProgressAtTimestamp(timestamp);
          const easedProgressDistance =
            easing(getProgressAtTimestamp(timestamp + deltaTime)) -
            easing(getProgressAtTimestamp(timestamp));
          const easingFactor = easedProgressDistance / progressDistance;

          const desiredPlaybackRate = basePlaybackRate * easingFactor;

          if (this.debug)
            console.info('ScrollyVideo playbackRate:', desiredPlaybackRate);
          // eslint-disable-next-line no-restricted-globals
          if (!isNaN(desiredPlaybackRate)) {
            this.video.playbackRate = desiredPlaybackRate;
            this.video.play();
          }
          // Set the currentTime to the video's currentTime
          this.currentTime = this.video.currentTime;
        }
      }

      // Recursively calls ourselves until the animation is done.
      previousAnimationFrameTimestamp = timestamp;
      if (typeof requestAnimationFrame === 'function') {
        // eslint-disable-next-line no-undef
        this.transitioningRaf = requestAnimationFrame((currentTimestamp) =>
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
      this.transitioningRaf = requestAnimationFrame((startTimestamp) => {
        previousAnimationFrameTimestamp = startTimestamp;
        tick({
          startCurrentTime: this.currentTime,
          startTimestamp,
          timestamp: startTimestamp,
        });
      });
    }
  }

  /**
   * Sets the currentTime of the video as a specified percentage of its total duration.
   *
   * @param percentage - The percentage of the video duration to set as the current time.
   * @param options - Configuration options for adjusting the video playback.
   *    - jump: boolean - If true, the video currentTime will jump directly to the specified
   *   percentage. If false, the change will be animated over time.
   *    - transitionSpeed: number - Defines the speed of the transition when `jump` is false.
   *   Represents the duration of the transition in milliseconds. Default is 8.
   *    - easing: (progress: number) => number - A function that defines the easing curve for the
   *   transition. It takes the progress ratio (a number between 0 and 1) as an argument and
   *   returns the eased value, affecting the playback speed during the transition.
   */
  setTargetTimePercent(percentage, options = {}) {
    const targetDuration =
      this.frames.length && this.frameRate
        ? this.frames.length / this.frameRate
        : this.video.duration;
    // The time we want to transition to
    this.targetTime = Math.max(Math.min(percentage, 1), 0) * targetDuration;

    // If we are close enough, return early
    if (
      !options.jump &&
      Math.abs(this.currentTime - this.targetTime) < this.frameThreshold
    )
      return;

    // Play the video if we are in video mode
    // I don't understand this. This only starts to play if the video is *not* paused,
    // as in: already playing? WTF?
    if (!this.canvas && !this.video.paused) this.video.play();

    this.transitionToTargetTime(options);
  }

  /**
   * Simulate trackScroll programmatically (scrolls on page by percentage of video)
   *
   * @param percentage
   */
  setScrollPercent(percentage) {
    if (!this.trackScroll) {
      console.warn('`setScrollPercent` requires enabled `trackScroll`');
      return;
    }

    const parent = this.container.parentNode;
    const { top, height } = parent.getBoundingClientRect();

    // eslint-disable-next-line no-undef
    const startPoint = top + window.pageYOffset;
    // eslint-disable-next-line no-undef
    const containerHeightInViewport = height - window.innerHeight;
    const targetPosition = startPoint + containerHeightInViewport * percentage;

    if (isScrollPositionAtTarget(targetPosition)) {
      this.targetScrollPosition = null;
    } else {
      // eslint-disable-next-line no-undef
      window.scrollTo({ top: targetPosition, behavior: 'smooth' });
      this.targetScrollPosition = targetPosition;
    }
  }

  /**
   * Call to destroy this ScrollyVideo object
   */
  destroy() {
    if (this.debug) console.info('Destroying ScrollyVideo');

    if (this.trackScroll)
      // eslint-disable-next-line no-undef
      window.removeEventListener('scroll', this.updateScrollPercentage);

    // eslint-disable-next-line no-undef
    window.removeEventListener('resize', this.resize);

    // Clear frames from memory
    if (this.frames) {
      this.frames.forEach((frame) => frame.close());
      this.frames = [];
    }

    // Clear component
    if (this.container) this.container.innerHTML = '';
  }
}

export default ScrollyVideo;
