class VideoFullscreenMonitor {
  constructor() {
    this.delay = 0
    this.activeVideo = null
    this.delayController = null
    this.isFullscreen = false
    this.observer = null
    
    this.videoPlayHandler = (event) => {
      this.getFullscreenState((isFullscreen) => {
        this.getVideo()
      })
    }
    
    this.fullscreenChangeHandler = (event) => {
      const fullscreenElement = document.fullscreenElement
      if (!fullscreenElement) {
        this.cleanupDelayController()
        return
      }
    
      this.activeVideo = fullscreenElement.tagName === 'VIDEO' 
        ? fullscreenElement 
        : fullscreenElement.querySelector('video')
    
      if (this.activeVideo) {
        this.setFullscreenState(true)
        this.initializeDelayController()
      }
    }
    
    this.setupMessageListener()
    
    try {
      chrome.storage.local.get(['delay', 'enabled'], (result) => {
        this.delay = result.delay || 0
        const isEnabled = result.enabled !== undefined ? result.enabled : false
        
        if (this.delay > 0 && isEnabled) {
          this.setupFullscreenListener()
          this.setupVideoListeners()
        }
      })
    } catch (e) {
      // Ignore
    }
  }

  setFullscreenState(value) {
    this.isFullscreen = value
    
    try {
      chrome.storage.local.set({ isFullscreen: value })
    } catch {
      // Ignore
    }
  }

  getFullscreenState(callback) {
    try {
      chrome.storage.local.get(['isFullscreen'], (result) => {
        if (result.hasOwnProperty('isFullscreen')) {
          this.isFullscreen = result.isFullscreen
        }

        callback(this.isFullscreen)
      })
    } catch {
      callback(this.isFullscreen)
    }
  }

  setupFullscreenListener() {
    this.removeFullscreenListener()
    document.addEventListener('fullscreenchange', this.fullscreenChangeHandler)
  }
  
  removeFullscreenListener() {
    document.removeEventListener('fullscreenchange', this.fullscreenChangeHandler)
  }

  setupVideoListeners() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    
    this.observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.tagName === 'VIDEO') {
            this.addPlayListener(node)
          }

          else if (node.querySelectorAll) {
            node.querySelectorAll('video').forEach(video => {
              this.addPlayListener(video)
            })
          }
        })
      })
    })
    
    this.observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    })
    
    document.querySelectorAll('video').forEach(video => {
      video.removeEventListener('play', this.videoPlayHandler)
    })
    
    document.querySelectorAll('video').forEach(video => {
      this.addPlayListener(video)
    })
  }

  addPlayListener(video) {
    video.removeEventListener('play', this.videoPlayHandler)
    video.addEventListener('play', this.videoPlayHandler)
  }

  removePlayListener() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    
    document.querySelectorAll('video').forEach(video => {
      video.removeEventListener('play', this.videoPlayHandler)
    })
  }

  getVideo() {
    if (this.delay <= 0) return
    
    const minWidth = window.innerWidth - 1
    const minHeight = window.innerHeight - 1
    document.querySelectorAll('video').forEach(video => {
      const rect = video.getBoundingClientRect()
      if (rect.width >= minWidth && rect.height >= minHeight) {
        this.activeVideo = video
      }
    })

    if (this.activeVideo) {
      const hasCanvas = !!this.activeVideo.closest('.video-delay-container')
      
      if (!hasCanvas && this.isFullscreen) {
        this.delayController = new VideoDelayController(this.activeVideo, this.delay, true)
      }
    }
  }

  cleanupDelayController() {
    if (this.delayController) {
      this.delayController.stop()
      this.delayController = null
    }
    
    if (this.activeVideo) {
      this.activeVideo.style.opacity = '1'
      this.activeVideo.style.width = ''
      this.activeVideo.style.height = ''
      
      const container = this.activeVideo.closest('.video-delay-container')
      if (container) {
        const parent = container.parentNode
        parent.insertBefore(this.activeVideo, container)
        container.remove()
      }
    }
    
    this.activeVideo = null
    this.setFullscreenState(false)
  }

  setupMessageListener() {
    try {
      chrome.runtime.onMessage.addListener((message) => {
        
        if (message.type === 'setDelay') {
          this.delay = message.delay || 0
          
          this.removeFullscreenListener()
          this.removePlayListener()
          this.cleanupDelayController()
          
          if (this.delay > 0) {
            this.setupFullscreenListener()
            this.setupVideoListeners()
          }
        }
        return true
      })
    } catch (error) {
      if (!error.message.includes('Extension context invalidated')) {
        // Ignore
      }
    }
  }

  initializeDelayController() {
    if (!this.activeVideo || !document.fullscreenElement || this.delay <= 0) return
    
    if (!this.delayController) {
      this.delayController = new VideoDelayController(this.activeVideo, this.delay, false)
    }
  }

  cleanupMonitor() {
    this.removeFullscreenListener()
    this.removePlayListener()
    this.cleanupDelayController()
    this.activeVideo = null
    this.delayController = null
  }

  reinitialize() {
    this.cleanupMonitor()
    this.setupMessageListener()
    
    try {
      chrome.storage.local.get(['delay', 'enabled'], (result) => {
        this.delay = result.delay || 0
        const isEnabled = result.enabled !== undefined ? result.enabled : false
        
        if (this.delay > 0 && isEnabled) {
          this.setupFullscreenListener()
          this.setupVideoListeners()
        }
      })
    } catch (e) {
      // Ignore
    }
  }
}

class VideoDelayController {
  constructor(video, delay, autoplayed) {
    this.video = video
    this.delay = delay
    this.originalWidth = video.offsetWidth
    this.originalHeight = video.offsetHeight
    this.isAutoplayed = autoplayed
    this.wasAutoplayed = autoplayed
    this.frameQueue = []
    this.isProcessing = false
    this.canvas = null
    this.context = null
    this.container = null
    this.initialFrame = null
    this.frameInterval = 0
    this.bufferStartTime = performance.now()
    this.lastFrameTime = performance.now()

    this.video.addEventListener('loadedmetadata', () => {
      this.frameInterval = this.detectFrameInterval()
    })

    this.video.addEventListener('loadeddata', () => {
      if (this.canvas && this.context && this.delay > 0) {
        const frame = this.captureFrame()
        if (frame) {
          this.initialFrame = frame
          this.context.drawImage(frame.canvas, 0, 0, this.canvas.width, this.canvas.height)
        }
      }
    })

    this.setupCanvas()
    this.startProcessing()
    this.checkFullscreen()
  }

  checkFullscreen() {
    this.fullscreenCheckInterval = setInterval(() => {
      if (!this.isAutoplayed) return

      const rect = this.video.getBoundingClientRect()
      const closerToOriginal = Math.abs(Math.round(rect.width - this.originalWidth)) < Math.abs(Math.round(rect.width - window.innerWidth))

      if (closerToOriginal) {
        this.isAutoplayed = false
        clearInterval(this.fullscreenCheckInterval)
        this.stop()
      }
    }, 100)
  }

  setupCanvas() {
    if ((!document.fullscreenElement && !this.isAutoplayed) || !this.video) return

    this.container = document.createElement('div')
    this.container.className = 'video-delay-container'
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'video-delay-canvas'
    this.video.style.opacity = '0'
    this.canvas.style.opacity = '1'
    
    if (!this.canvas) return
    this.context = this.canvas.getContext('2d', { 
      alpha: false,
      willReadFrequently: false
    })
    
    if (!this.context) return

    if (this.video.parentNode) {
      this.video.parentNode.insertBefore(this.container, this.video)
      this.container.appendChild(this.video)
      this.container.appendChild(this.canvas)
    }

    if (this.video.videoWidth && this.video.videoHeight) {
      this.canvas.width = this.video.videoWidth
      this.canvas.height = this.video.videoHeight
    } else {
      this.canvas.width = this.video.offsetWidth || 640
      this.canvas.height = this.video.offsetHeight || 360
      
      this.video.addEventListener('loadedmetadata', () => {
        if (this.canvas) {
          this.canvas.width = this.video.videoWidth
          this.canvas.height = this.video.videoHeight
          this.updateCanvasScale()
        }
      }, { once: true })
    }

    this.updateCanvasScale()
    this.context.imageSmoothingEnabled = false

    if (this.canvas && this.video) {
      this.canvas.style.opacity = this.delay > 0 ? '1' : '0'
      this.video.style.opacity = this.delay > 0 ? '0' : '1'
    }

    window.addEventListener('resize', () => {
      if (document.fullscreenElement) {
        this.updateCanvasScale()
      }
    })
    this.setupInitialState()
  }

  updateCanvasScale() {
    if (!this.video || !this.canvas || !this.canvas.style) return

    const scale = Math.min(
      window.innerWidth / (this.video.videoWidth || this.video.offsetWidth || 640),
      window.innerHeight / (this.video.videoHeight || this.video.offsetHeight || 360)
    )

    const scaledWidth = (this.video.videoWidth || this.video.offsetWidth || 640) * scale
    const scaledHeight = (this.video.videoHeight || this.video.offsetHeight || 360) * scale

    this.canvas.style.width = `${scaledWidth}px`
    this.canvas.style.height = `${scaledHeight}px`

    if (this.video.style) {
      this.video.style.width = `${scaledWidth}px`
      this.video.style.height = `${scaledHeight}px`
    }
  }

  detectFrameInterval() {
    const commonFps = [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]
    let lastTime = performance.now()
    let samples = []
    let sampleCount = 0

    const measureInterval = () => {
      if (sampleCount >= 60) return

      const currentTime = performance.now()
      const delta = currentTime - lastTime
      lastTime = currentTime

      if (delta > 0) {
        samples.push(delta)
        sampleCount++

        if (sampleCount >= 60) {
          const avgDelta = samples.reduce((a, b) => a + b) / samples.length
          const measuredFps = 1000 / avgDelta
          const closestFps = commonFps.reduce((prev, curr) => 
            Math.abs(curr - measuredFps) < Math.abs(prev - measuredFps) ? curr : prev
          )

          this.frameInterval = 1000 / closestFps
          return
        }
      }

      requestAnimationFrame(measureInterval)
    }

    requestAnimationFrame(measureInterval)
    return 1000 / 60
  }

  captureFrame() {
    if (!this.video || (!this.video.videoWidth && !this.video.offsetWidth) || (!this.video.videoHeight && !this.video.offsetHeight) || this.video.readyState < 2) return null

    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = this.video.videoWidth || this.video.offsetWidth
    tempCanvas.height = this.video.videoHeight || this.video.offsetHeight

    const tempContext = tempCanvas.getContext('2d', {
      alpha: false,
      willReadFrequently: false
    })

    if (!tempContext) return null

    tempContext.imageSmoothingEnabled = false

    try {
      tempContext.drawImage(this.video, 0, 0, tempCanvas.width, tempCanvas.height)
      
      return {
        canvas: tempCanvas, timestamp: performance.now()
      }
    } catch (e) {
      tempCanvas.width = 0
      tempCanvas.height = 0
      return null
    }
  }

  setupInitialState() {
    if (!this.video || !this.context) return
    
    this.context.fillStyle = '#000000'
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height)
    const handleFirstFrame = () => {
      if (this.video.readyState >= 2) {
        const frame = this.captureFrame()
        if (frame) {
          try {
            this.initialFrame = frame
            this.context.drawImage(frame.canvas, 0, 0, this.canvas.width, this.canvas.height)
          } catch {
            // Ignore
          }
        }
      }
    }
    
    this.video.addEventListener('loadeddata', handleFirstFrame)

    handleFirstFrame()
  }

  async startProcessing() {
    if (this.isProcessing) return
    this.isProcessing = true
    this.bufferStartTime = performance.now()
    this.lastFrameTime = performance.now()

    const processFrame = async (timestamp) => {
      if (!this.isProcessing || (!document.fullscreenElement && !this.isAutoplayed) || !this.video || !this.canvas || !this.context) {
        this.isProcessing = false
        return
      }

      if (this.delay > 0 && this.video.readyState >= 2) {
        const now = performance.now()
        const timeSinceLastFrame = now - this.lastFrameTime

        if (timeSinceLastFrame >= this.frameInterval) {
          const frame = this.captureFrame()
          if (frame) {
            if (!this.initialFrame) {
              this.initialFrame = frame
              this.context.drawImage(frame.canvas, 0, 0, this.canvas.width, this.canvas.height)
            }

            this.frameQueue.push(frame)
            this.lastFrameTime = now

            while (this.frameQueue.length > 0) {
              const oldestFrame = this.frameQueue[0]
              const frameAge = now - oldestFrame.timestamp

              if (frameAge > this.delay) {
                const removedFrame = this.frameQueue.shift()
                if (removedFrame && removedFrame.canvas) {
                  removedFrame.canvas.width = 0
                  removedFrame.canvas.height = 0
                }
              } else {
                break
              }
            }

            const maxBufferSize = Math.ceil((this.delay / this.frameInterval) * 1.5)
            while (this.frameQueue.length > maxBufferSize) {
              const removedFrame = this.frameQueue.shift()
              if (removedFrame && removedFrame.canvas) {
                removedFrame.canvas.width = 0
                removedFrame.canvas.height = 0
              }
            }
          }
        }

        const timeSinceStart = now - this.bufferStartTime
        if (timeSinceStart >= this.delay && this.frameQueue.length > 0) {
          const frameToShow = this.frameQueue[0]
          if (frameToShow && frameToShow.canvas) {
            this.context.drawImage(frameToShow.canvas, 0, 0, this.canvas.width, this.canvas.height)
          }
        } else if (this.initialFrame && this.initialFrame.canvas) {
          this.context.drawImage(this.initialFrame.canvas, 0, 0, this.canvas.width, this.canvas.height)
        }
      }

      requestAnimationFrame(processFrame)
    }

    requestAnimationFrame(processFrame)
  }

  stop() {
    this.isProcessing = false

    for (const frame of this.frameQueue) {
      if (frame && frame.canvas) {
        frame.canvas.width = 0
        frame.canvas.height = 0
      }
    }

    this.frameQueue = []

    if (this.initialFrame && this.initialFrame.canvas) {
      this.initialFrame.canvas.width = 0
      this.initialFrame.canvas.height = 0
      this.initialFrame = null
    }

    if (this.video) {
      this.video.style = ''
      this.video.removeAttribute('style')
    }

    if (this.container && this.container.parentNode && this.video) {
      const parent = this.container.parentNode
      parent.insertBefore(this.video, this.container)
      this.container.remove()
    } 

    this.canvas = null
    this.context = null
    this.container = null
    this.lastFrameTime = 0
    this.frameInterval = 0
    this.bufferStartTime = 0
    this.delay = 0
    this.isAutoplayed = false
    
    if (this.wasAutoplayed) {
      clearInterval(this.fullscreenCheckInterval)
      this.fullscreenCheckInterval = null
      this.wasAutoplayed = false
      monitor.reinitialize()
    }
  }
}

const monitor = new VideoFullscreenMonitor()