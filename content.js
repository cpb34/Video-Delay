class VideoMonitor {
  constructor() {
    this.delay = 0
    this.video = null
    this.delayedVideo = null
    this.isFullscreen = false
    this.observer = null

    this.initializeEventListeners()
    
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

  initializeEventListeners() {
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
    
      this.video = fullscreenElement.tagName === 'VIDEO' 
        ? fullscreenElement 
        : fullscreenElement.querySelector('video')
    
      if (this.video) {
        this.setFullscreenState(true)
        this.delayVideo()
      }

      this.setupMessageListener()
    }
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
      })
    } catch (error) {
      // Ignore
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

  setFullscreenState(value) {
    this.isFullscreen = value
    
    try {
      chrome.storage.local.set({ isFullscreen: value })
    } catch {
      // Ignore
    }
  }

  getVideo() {
    if (this.delay === 0) return
    
    const minWidth = window.innerWidth - 1
    const minHeight = window.innerHeight - 1
    document.querySelectorAll('video').forEach(video => {
      const rect = video.getBoundingClientRect()
      if (rect.width >= minWidth && rect.height >= minHeight) {
        this.video = video
      }
    })

    if (this.video) {
      const hasCanvas = !!this.video.closest('.video-delay-container')
      
      if (!hasCanvas && this.isFullscreen) {
        this.delayedVideo = new DelayedVideo(this.video, this.delay, true)
      }
    }
  }

  delayVideo() {
    if (!this.video || !document.fullscreenElement || this.delay === 0) return
    
    if (!this.delayedVideo) {
      this.delayedVideo = new DelayedVideo(this.video, this.delay, false)
    }
  }

  cleanupDelayController() {
    if (this.delayedVideo) {
      this.delayedVideo.stop()
      this.delayedVideo = null
    }
    
    this.setFullscreenState(false)
  }

  cleanupMonitor() {
    this.removeFullscreenListener()
    this.removePlayListener()
    this.cleanupDelayController()
    this.video = null
    this.delayedVideo = null
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

class DelayedVideo {
  constructor(video, delay, autoplayed) {
    this.video = video
    this.delay = delay
    this.isAutoplayed = autoplayed
    this.wasAutoplayed = autoplayed
    this.isProcessing = false
    this.canvas = null
    this.context = null
    this.container = null
    this.frameQueue = []
    this.initialFrame = null
    this.frameInterval = 0
    this.bufferStartTime = performance.now()
    this.lastFrameTime = performance.now()

    this.subtitleElements = []
    this.hiddenSubtitleElements = []
    this.subtitleCheckInterval = null
    this.currentSubtitleLines = []
    this.delayedSubtitleLines = []
    
    this.initializeEventListeners()
    this.setupCanvas()
  
    this.isAutoplayed ? this.startSubtitlePolling() : this.findSubtitleElements()
    
    this.checkFullscreen()
    this.startProcessing()
  }

  initializeEventListeners() {
    this.video.addEventListener('loadedmetadata', () => {
      this.frameInterval = this.detectFrameInterval()
      this.updateCanvasDimensions()
    })

    this.video.addEventListener('loadeddata', () => {
      this.handleVideoDataLoaded()
    })
    
    this.video.addEventListener('resize', () => {
      this.updateCanvasDimensions()
    })

    window.addEventListener('resize', () => {
      if (document.fullscreenElement) {
        this.updateCanvasScale()
      }
    })
  }

  checkFullscreen() {
    this.fullscreenCheckInterval = setInterval(() => {
      if (!this.isAutoplayed) return

      const rect = this.video.getBoundingClientRect()
      const closerToOriginal = Math.abs(Math.round(rect.width - this.video.offsetWidth)) < Math.abs(Math.round(rect.width - window.innerWidth))

      if (closerToOriginal) {
        this.isAutoplayed = false
        clearInterval(this.fullscreenCheckInterval)
        this.stop()
      }
    }, 50)
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
    }
  
    this.updateCanvasScale()

    this.context.imageSmoothingEnabled = false
  
    if (this.canvas && this.video) {
      this.canvas.style.opacity = this.delay > 0 ? '1' : '0'
      this.video.style.opacity = this.delay > 0 ? '0' : '1'
    }
    
    this.setupInitialState()
  }
  
  setupInitialState() {
    if (!this.video || !this.context) return
    
    this.context.fillStyle = '#000000'
    this.context.fillRect(0, 0, this.canvas.width, this.canvas.height)
    
    this.handleVideoDataLoaded()
  }

  updateCanvasScale() {
    if (!this.video || !this.canvas || !this.canvas.style) return
  
    if (this.video.videoWidth && this.video.videoHeight && 
        (this.canvas.width !== this.video.videoWidth || this.canvas.height !== this.video.videoHeight)) {
      this.canvas.width = this.video.videoWidth
      this.canvas.height = this.video.videoHeight
      this.context.imageSmoothingEnabled = false
    }
    
    const scale = Math.min(
      window.innerWidth / (this.video.videoWidth || this.video.offsetWidth || 640),
      window.innerHeight / (this.video.videoHeight || this.video.offsetHeight || 360)
    )
  
    const scaledWidth = Math.round((this.video.videoWidth || this.video.offsetWidth || 640) * scale)
    const scaledHeight = Math.round((this.video.videoHeight || this.video.offsetHeight || 360) * scale)
  
    this.canvas.style.width = `${scaledWidth}px`
    this.canvas.style.height = `${scaledHeight}px`
  
    if (this.video.style) {
      this.video.style.width = `${scaledWidth}px`
      this.video.style.height = `${scaledHeight}px`
    }
  }

  updateCanvasDimensions() {
    if (!this.canvas || !this.video.videoWidth || !this.video.videoHeight) return
    
    this.canvas.width = this.video.videoWidth
    this.canvas.height = this.video.videoHeight
    this.updateCanvasScale()
  }

  handleVideoDataLoaded() {
    if (!this.video || !this.context || this.video.readyState < 2 || !this.delay) return
    
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
            this.renderSubtitles(this.canvas.width, this.canvas.height)
          }
        } else if (this.initialFrame && this.initialFrame.canvas) {
          this.context.drawImage(this.initialFrame.canvas, 0, 0, this.canvas.width, this.canvas.height)
        }
      }
  
      requestAnimationFrame(processFrame)
    }
  
    requestAnimationFrame(processFrame)
  }
      
  findSubtitleElements() {
    const captionElements = document.querySelectorAll('[class*="caption"]')
    
    if (captionElements.length > 0) {
      const visibleCaptions = Array.from(captionElements).filter(element => {
        const styles = window.getComputedStyle(element)
        return styles.display !== 'none' && styles.visibility !== 'hidden' && styles.opacity !== '0'
      })
      
      const hasJwCaptions = visibleCaptions.some(element => 
        element.innerHTML.trim().includes('jw-reset')
      )

      if (!hasJwCaptions) return false

      this.subtitleElements = Array.from(visibleCaptions)

      this.setupSubtitleTracking()

      return true
    }
    
    return false
  }

  startSubtitlePolling() {
    let subtitlesFound = false

    this.subtitlePollInterval = setInterval(() => {
      if (!this.isProcessing || this.video.width !== 0 || subtitlesFound) {
        clearInterval(this.subtitlePollInterval)
        this.subtitlePollInterval = null
        return
      }
      
      if (!subtitlesFound) {
        const found = this.findSubtitleElements()
        if (found) {
          subtitlesFound = true
        }
      }
    }, 50)
  }
  
  setupSubtitleTracking() {
    this.subtitleElements.forEach(element => {
      const originalStyles = {
        opacity: element.style.opacity,
        display: element.style.display
      }

      element.style.setProperty('opacity', '0', 'important')
      
      this.hiddenSubtitleElements.push({
        element: element,
        originalStyles: originalStyles
      })
    })
          
    this.captureSubtitleData()
  }
  
  captureSubtitleData() {
    this.subtitleCheckInterval = setInterval(() => {
      if (!this.isProcessing) {
        clearInterval(this.subtitleCheckInterval)
        return
      }
  
      let lines = []
      
      this.subtitleElements.forEach(element => {
        const html = element.innerHTML.trim()
        
        if (html) {
          let startIndex = 0
          while (true) {
            startIndex = html.indexOf('plaintext;">', startIndex)
            if (startIndex === -1) break
            
            startIndex += 'plaintext;">'.length
            
            const endIndex = html.indexOf('</div>', startIndex)
            if (endIndex === -1) break
            
            const content = html.substring(startIndex, endIndex)
            
            let style = 'normal'
            let text = content
            
            if (content.match(/<i>.*<\/i>/)) {
              style = 'italic'
              text = content.replace(/<\/?i>/g, '')
            } else if (content.match(/<b>.*<\/b>/)) {
              style = 'bold'
              text = content.replace(/<\/?b>/g, '')
            }
  
            if (text.includes('\n')) {
              const textParts = text.split('\n')
              
              textParts.forEach(part => {
                if (part.trim()) {
                  lines.push({ text: part.trim(), style })
                }
              })
            } else {
              lines.push({ text, style })
            }
            
            startIndex = endIndex
          }
        }
      })
  
      this.currentSubtitleLines = lines
      
      this.scheduleSubtitleDelay()
      
    }, this.frameInterval)
  }

  scheduleSubtitleDelay() {
    const currentSubtitleLines = this.currentSubtitleLines
    
    setTimeout(() => {
      this.delayedSubtitleLines = currentSubtitleLines
    }, this.delay)
  }

  renderSubtitles(canvasWidth, canvasHeight) {
    if (this.delayedSubtitleLines.length === 0 || !this.context) return
    
    this.context.save()
    
    const baselineY = canvasHeight * 0.865
    const fontSize = Math.max(16, Math.round((44 / 1080) * canvasHeight))
    const lineSpacing = fontSize * 1.5
    let verticalPositions = []
    const totalLines = this.delayedSubtitleLines.length

    let i = 0
    
    while (i < totalLines) {
      verticalPositions.push(baselineY - (totalLines - 1 - i) * lineSpacing)
      i++
    }

    this.context.textAlign = 'center'
    this.context.textBaseline = 'middle'

    this.delayedSubtitleLines.forEach((line, lineIndex) => {
      const lineText = line.text
      const lineY = verticalPositions[lineIndex]
      
      let fontStyle = line.style
      this.context.font = `${fontStyle} ${fontSize}px Helvetica, sans-serif`
      
      const textMetrics = this.context.measureText(lineText)
      const textWidth = textMetrics.width
      const padding = fontSize * 0.3
      
      this.context.fillStyle = 'rgba(0, 0, 0, 0.5)'
      this.context.fillRect(
        canvasWidth / 2 - textWidth / 2 - padding + 4,
        lineY - fontSize / 1.75 - padding / 2,
        textWidth + padding * 2 - 7,
        fontSize + padding - 1
      )
      
      this.context.fillStyle = 'rgb(255, 255, 255)'
      this.context.fillText(lineText, canvasWidth / 2, lineY)
    })

    this.context.restore()
  }

  stop() {
    this.isProcessing = false
    
    if (this.subtitleCheckInterval) {
      clearInterval(this.subtitleCheckInterval)
      this.subtitleCheckInterval = null
    }
  
    if (this.subtitlePollInterval) {
      clearInterval(this.subtitlePollInterval)
      this.subtitlePollInterval = null
    }
    
    if (this.hiddenSubtitleElements && this.hiddenSubtitleElements.length > 0) {        
      this.hiddenSubtitleElements.forEach(item => {
        if (item.element) {
          item.element.style.removeProperty('opacity')
          
          if (item.originalStyles) {
            Object.entries(item.originalStyles).forEach(([prop, value]) => {
              if (value !== undefined && value !== null) {
                item.element.style[prop] = value
              }
            })
          }
        }
      })
      
      this.hiddenSubtitleElements = []
    }
    
    this.subtitleElements = []
    this.currentSubtitleLines = []
    this.delayedSubtitleLines = []
    
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
    
    if (this.wasAutoplayed) {
      clearInterval(this.fullscreenCheckInterval)
      this.fullscreenCheckInterval = null
      this.wasAutoplayed = false
      monitor.reinitialize()
    }
  }
}

const monitor = new VideoMonitor()