import UAParser from 'ua-parser-js';
import VideoDecoderWorker from 'web-worker:./videoDecoder';
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
 * @class
 */
class ScrollyVideo {
  /**
   * @constructor
   *
   * @param {Object} opts
   * @param {string} opts.src  - The src of the video, required
   * @param {string | HTMLElement} opts.scrollyVideoContainer - The dom element or id that this
   *   object will be created in, required
   * @param {'contain' | 'cover'} [opts.objectFit='contain'] - Whether the video should "cover"
   *   inside the container
   * @param {boolean} [opts.sticky=true] - Whether the video should "stick" to the top of the
   *   container
   * @param {boolean} [opts.trackScroll=true] - Whether this object should automatically respond to
   *   scroll. If true, will ignore `transitionSpeed` and `easing` properties.
   * @param {boolean} [opts.lockScroll=true] - Whether it ignores human scroll while it runs
   *   `setVideoPercentage` with enabled `trackScroll`
   * @param {number} [opts.transitionSpeed=16] - For cases when `trackScroll` is disabled, how fast
   *    the video should transition to the next point, in milliseconds.
   *    When set to 0, use the inherent video framerate and transition to the next point using
   *    the video's own speed. These transitions are not bound to happen within a fixed timeframe.
   * @param {number} [opts.frameThreshold=0.05] - When to stop the video animation, in seconds
   * @param {boolean} [opts.useWebCodecs=true] - Decode the video and paint the frames to a canvas
   *   element. Helps getting a smoother animation (especially when going backwards), but requires
   *   more performance.
   * @param {() => void} [opts.onReady] - A callback that invokes on video decode
   * @param {(number) => void} [opts.onChange] - A callback that invokes on video percentage change
   * @param {boolean} [opts.debug=false] - Whether to print debug stats to the console
   * @param {(number) => number} [opts.easing=(x)=>x] - When using `transitionSpeed`, which easing
   *   function to use to smooth out the animation
   */
  constructor({
    src,
    scrollyVideoContainer,
    objectFit = 'contain',
    sticky = true,
    trackScroll = true,
    lockScroll = true,
    transitionSpeed = 16,
    frameThreshold = 0.05,
    useWebCodecs = true,
    onReady = () => {},
    onChange = () => {},
    debug = false,
    easing = (x) => x,
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
    this.easing = easing;

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
    this.setElementExpansion(this.video);

    // Adds the video to the container
    this.layoutContainer = document.createElement('div');
    this.layoutContainer.classList.add('scrollyvideo-layout-container');
    this.layoutContainer.style.position = 'relative';
    this.layoutContainer.style.width = '100%';
    this.layoutContainer.style.height = '100vh';

    this.container.appendChild(this.layoutContainer);
    this.layoutContainer.appendChild(this.video);

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

		const mobileOS = new UAParser().getOS()
	  this.isAndroid = mobileOS.name === 'Android';
		this.isIOS = mobileOS.name === 'iOS';
		this.isMobileDevice = this.isAndroid || this.isIOS

    // Initialize state variables
    this.currentTime = 0; // Saves the currentTime of the video, synced with this.video.currentTime
    this.targetTime = 0; // The target time before a transition happens

    const debouncedScroll = debounce(() => {
      // eslint-disable-next-line no-undef
      window.requestAnimationFrame(() => {
        this.setScrollPercent(this.videoPercentage);
      });
    }, 100);

    // Add scroll listener for responding to scroll position
    this.updateScrollPercentage = (jump) => {
      // handle cases where we get an event object instead of a boolean as a parameter
      if (jump && typeof jump === 'object') {
        jump = true;
      }

      // Used for internally setting the scroll percentage based on built-in listeners
      const containerBoundingClientRect =
        this.container.parentNode.getBoundingClientRect();

      // Calculate the current scroll percent of the video
      const scrollPercent =
        -containerBoundingClientRect.top /
        // eslint-disable-next-line no-undef
        (containerBoundingClientRect.height - window.innerHeight);

      if (this.debug) {
        console.debug('ScrollyVideo scrolled to', scrollPercent);
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
      window.addEventListener('scroll', this.updateScrollPercentage, {
        passive: true,
      });

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
      if (this.useCanvas) {
        this.setCoverStyle(this.canvas);
      }
    };

    // eslint-disable-next-line no-undef
    window.addEventListener('resize', this.resize);
    this.video.addEventListener('progress', this.resize);

    // Calls decode video to attempt webcodecs method
	  // Not using that on Android for now, because Android devices reliably crash
    if (window.Worker && !this.isMobileDevice) {
      this.decodeWorker = new VideoDecoderWorker();
      this.decodeVideo();
    } else {
      this.useCanvas = false;
    }
    this.onReady();
  }

  /**
   * The easing function to use when playing the video
   * @type {(x: number) => number}
   */
  #easing = (x) => x;

  /**
   * @param value {(x: number) => number}
   */
  set easing(value) {
    this.#easing = value;
  }

  /**
   * @returns {function(number): number}
   */
  get easing() {
    return this.#easing;
  }

  #useCanvas = false;

  set useCanvas(value) {
    this.#useCanvas = value;

    // adapt the visibility of the elements
    if (value) {
      if (this.debug) console.log('Switching to using the canvas.');
      // Draw current frame
      this.decodeWorker.postMessage({
        message: 'PAINT_CURRENT_TIME',
        currentTime: this.currentTime,
        debug: this.debug,
      });
      // cancel current animation
      window.cancelAnimationFrame(this.transitioningRaf);

      this.canvas.style.display = 'block';
      // Hide the video
      // this.video.style.display = 'none';

      // Allow inspection of individual frames
      if (this.debug) {
        window.videoscrollerPaintFrame = (frame) => {
          this.decodeWorker.postMessage({
            message: 'PAINT_FRAME',
            frame,
            debug: this.debug,
          });
        };
      }
    } else {
      if (this.debug) console.log('Turning canvas off; falling back to video');
      // synchronise the current time with the worker, in case it exists
      if (this.decodeWorker) {
	      this.decodeWorker.postMessage({
		      message: 'GET_CURRENT_TIME',
		      debug: this.debug,
	      });
      }

      // Show the video
      //this.video.style.display = 'block';
	    if (this.canvas) {
		    this.canvas.style.display = 'none';
	    }
    }
    // Update video to the latest requested frame
    // restart transition
    this.transitionToTargetTime({
      transitionSpeed: this.transitionSpeed,
      easing: this.easing,
    });
  }

  get useCanvas() {
    return this.#useCanvas;
  }

  /**
   * Sets the currentTime of the video as a specified percentage of its total duration.
   *
   * Public entry point to directly manipulate the video position.
   *
   * @param {number} percentage  - The percentage of the video duration to set as the current time.
   * @param {object} [options={}] - Configuration options for adjusting the video playback.
   * @param {boolean} options.jump - If true, the video currentTime will jump directly to the
   *   specified percentage. If false, the change will be animated over time.
   * @param {number} options.transitionSpeed - Defines the speed of the transition when `jump` is
   *   false. Represents the duration of the transition in milliseconds. Default is 16.
   * @param {(progress: number) => number} options.easing - A function that defines the easing
   *   curve for the transition. It takes the progress ratio (a number between 0 and 1) as an
   *   argument and returns the eased value, affecting the playback speed during the transition.
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
   * @param {HTMLVideoElement | HTMLCanvasElement} el
   */
  setCoverStyle(el) {
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.objectFit = this.objectFit;
  }

  setElementExpansion(el) {
    el.style.position = 'absolute';
    el.style.top = '0';
    el.style.left = '0';
    el.style.bottom = '0';
    el.style.right = '0';
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
      this.decodeWorker.postMessage({
        src: this.src,
        debug: this.debug,
        message: 'REQUEST_DECODE',
      });
      this.decodeWorker.onmessage = (event) => {
        const { message } = event.data;
        if (this.debug)
          console.debug(`Received message from worker.`, message, event.data);

        switch (message) {
          case 'DECODING_SUCCESS':
            // The video has been decoded, so we can set up the canvas
            this.canvas = document.createElement('canvas');
            const offscreen = this.canvas.transferControlToOffscreen();
            this.layoutContainer.append(this.canvas);
            this.setElementExpansion(this.canvas);
            this.setCoverStyle(this.canvas);
            this.decodeWorker.postMessage(
              {
                canvas: offscreen,
                debug: this.debug,
                message: 'SETUP_CANVAS',
                duration: this.video.duration,
                currentTime: this.currentTime,
              },
              [offscreen],
            );
            break;

          case 'CANVAS_CREATED':
            this.useCanvas = true;
            break;

          case 'CURRENT_TIME':
            this.currentTime = event.data.currentTime;

            // getting the current time is the last thing we should get when we disable the use of canvas
            // in this case the worker should be terminated
            if (!this.useCanvas) {
              this.decodeWorker.terminate();
            }

            break;

          default:
            if (this.debug)
              console.info('Message was not be processed.', message);
        }
      };
    } catch (error) {
      if (this.debug)
        console.error('Error encountered while decoding video', error);

      // move back to video
      this.useCanvas = false;
      this.decodeWorker.terminate();
    }

    this.decodeWorker.onerror = (event) => {
      if (this.debug)
        console.error('Decode Worker encountered an error', event);

      // fall back to video
      this.useCanvas = false;
      this.decodeWorker.terminate();
    };

    this.onReady();
  }

  /**
   * Transitions the video or the canvas to the proper frame.
   *
   * @param {Object} options - Configuration options for adjusting the video playback.
   * @param {boolean} options.jump - If true, the video currentTime will jump
   *   directly to the specified percentage. If false, the change will be animated over time.
   * @param {number} options.transitionSpeed - Defines the speed of the transition when `jump` is
   *   false. Represents the duration of the transition in milliseconds. Default is 8. Use 0 to use
   *   the native speed of the video.
   * @param {(progress: number) => number} options.easing - A function that defines the easing
   *   curve for the transition. It takes the progress ratio (a number between 0 and 1) as an
   *   argument and returns the eased value, affecting the playback speed during the transition.
   */
  transitionToTargetTime({
    jump = false,
    transitionSpeed = this.transitionSpeed,
    easing = this.easing,
  }) {
    if (this.debug) {
      console.table({
        transitionSpeed,
        easing,
        jump,
        currentTime: this.currentTime,
        targetTime: this.targetTime,
        useCanvas: this.useCanvas,
      });
    }

    // hand off request to the web worker if we're using canvas
    if (this.useCanvas) {
      {
        this.decodeWorker.postMessage({
          message: 'REQUEST_TRANSITION',
          targetTime: this.targetTime,
          currentTime: this.currentTime,
          options: {
            jump,
            transitionSpeed,
            /* easing, */
          },
          debug: this.debug,
        });

        return;
      }

      /*       catch {
        if (this.debug) console.error('We run into trouble. Falling back to the video.')
        this.useCanvas = false;
      } */
    }

    const diff = this.targetTime - this.currentTime;
    const distance = Math.abs(diff);
    const duration = distance * 1000; // convert to milliseconds
    const isForwardTransition = diff > 0;
    const directionFactor = isForwardTransition ? 1 : -1;

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
        this.currentTime = this.targetTime;

        // Video Mode
        this.video.pause();
        this.video.currentTime = this.currentTime;
      } else if (transitionSpeed === 0) {
        // Use the native timing of the video
        // Works best with animated videos;
        // using the native speed assures that the original easings are respected.

        // Make sure the currentTime we want is close to the currentTime
        if (Math.abs(this.video.currentTime - this.currentTime) >= this.frameThreshold) {
          this.video.currentTime = this.currentTime;
        }

        // Add the deltaTime to the currentTime
        this.currentTime += deltaTime * 0.001 * directionFactor;
        if (isForwardTransition) {
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
        this.currentTime =
          startCurrentTime + easedProgress * duration * directionFactor * 0.001;

        if (this.isSafari || !isForwardTransition) {
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

          // clamp between 0.0625 - 16.0
          const desiredPlaybackRate = Math.min(
            Math.max(0.0625, basePlaybackRate * easingFactor),
            16,
          );

          if (this.debug)
            console.debug('ScrollyVideo playbackRate:', desiredPlaybackRate);
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
    const targetDuration = this.video.duration;
    const oldTargetTime = this.targetTime;
    // The time we want to transition to
    this.targetTime = Math.max(Math.min(percentage, 1), 0) * targetDuration;

    // If we are close enough, return early
    if (!options.jump && this.currentTimeIsCloseToTarget(this.targetTime)) {
      return;
    }

    if (
      this.targetTime > oldTargetTime &&
      oldTargetTime > this.currentTime &&
      !this.currentTimeIsCloseToTarget(oldTargetTime)
    ) {
      // moving forward in time, and we haven't reached the previous target yet
      // So we skip forward
      if (this.debug) console.debug('Skipping forward.')
      this.currentTime = oldTargetTime;
    }

    if (this.targetTime < this.currentTime) {
      // moving backward – we jump
      if (this.debug) console.debug('Moving backwards, jumping.')
      this.transitionToTargetTime({...options, jump: true})
      return;
    }

    // Play the video if we are in video mode
    // I don't understand this. This only starts to play if the video is *not* paused,
    // as in: already playing? WTF?
    if (!this.useCanvas && !this.video.paused) this.video.play();

    this.transitionToTargetTime(options);
  }

  currentTimeIsCloseToTarget = (target) => {
    return Math.abs(this.currentTime - target) < this.frameThreshold;
  };

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
    if (this.debug) console.log('Destroying ScrollyVideo');

    if (this.decodeWorker) this.decodeWorker.terminate();

    if (this.trackScroll)
      // eslint-disable-next-line no-undef
      window.removeEventListener('scroll', this.updateScrollPercentage);

    // eslint-disable-next-line no-undef
    window.removeEventListener('resize', this.resize);

    // Clear component
    if (this.container) this.container.innerHTML = '';
  }
}

export default ScrollyVideo;
