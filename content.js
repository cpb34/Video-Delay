class VideoMonitor {
  constructor() {
    this.startVideoMonitor()
    this.startEventListeners()
  }

  startVideoMonitor() {
    try {
      chrome.storage.local.get(['delay', 'enabled'], (result) => {
        this.delay = result.delay || 0
        if (result.enabled && this.delay > 0) {
          this.setupFullscreenListener()
          this.setupVideoListeners()
        }
      })
      chrome.runtime.onMessage.addListener((message) => {
        chrome.storage.local.get(['enabled'], (result) => {
          if (message.type == 'setDelay') {
            this.delay = message.delay || 0
            this.removeFullscreenListener()
            this.removePlayListener()
            this.stopVideoDelay()
            if (result.enabled && this.delay > 0) {
              this.setupFullscreenListener()
              this.setupVideoListeners()
            }
          }
        })
      })
    } catch (error) {
      // Ignore
    }
  }

  startEventListeners() {
    this.videoPlayHandler = (event) => {
      if (this.video) return
      this.getFullscreenState((isFullscreen) => {
        if (this.delay == 0) return
        const minWidth = window.innerWidth - 10
        const minHeight = window.innerHeight - 10
        document.querySelectorAll('video').forEach(video => {
          const rect = video.getBoundingClientRect()
          if (rect.width >= minWidth || rect.height >= minHeight) {
            this.video = video
          }
        })
        if (this.video && this.isFullscreen && !this.video.closest('.video-delay-container')) {
          this.delayedVideo = new DelayedVideo(this.video, this.delay, true)
        }
      })
    }
    
    this.processFullscreenChange = (event) => {
      const fullscreenElement = document.fullscreenElement
      if (!fullscreenElement) {
        this.stopVideoDelay()
        return
      }
      this.video = fullscreenElement.tagName == 'VIDEO' 
        ? fullscreenElement 
        : fullscreenElement.querySelector('video')
      if (this.video) {
        this.setFullscreenState(true)
        if (!document.fullscreenElement || this.delay == 0) return
        if (!this.delayedVideo) {
          this.delayedVideo = new DelayedVideo(this.video, this.delay, false)
        }
      }
    }
  }

  setupFullscreenListener() {
    this.removeFullscreenListener()
    document.addEventListener('fullscreenchange', this.processFullscreenChange)
  }
  
  removeFullscreenListener() {
    document.removeEventListener('fullscreenchange', this.processFullscreenChange)
  }

  setupVideoListeners() {
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    this.observer = new MutationObserver(mutations => {
      mutations.forEach(mutation => {
        mutation.addedNodes.forEach(node => {
          if (node.tagName == 'VIDEO') this.addPlayListener(node)
          else if (node.querySelectorAll) node.querySelectorAll('video').forEach(video => this.addPlayListener(video))
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
        if (result.hasOwnProperty('isFullscreen')) this.isFullscreen = result.isFullscreen
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

  stopVideoDelay() {
    if (this.delayedVideo) {
      this.delayedVideo.stopDelayedVideo()
      this.delayedVideo = null
    }
    this.setFullscreenState(false)
  }

  stopVideoMonitor() {
    this.removeFullscreenListener()
    this.removePlayListener()
    this.stopVideoDelay()
    this.video = null
    this.delayedVideo = null
  }
}

class DelayedVideo {
  constructor(video, delay, autoplayed) {
    this.video = video
    this.delay = delay
    this.isAutoplayed = autoplayed
    this.wasAutoplayed = autoplayed
    this.frameQueue = []
    this.subtitleElements = []
    this.hiddenSubtitleElements = []
    this.currentSubtitleLines = []
    this.delayedSubtitleLines = []
    this.startEventListeners()
    this.setupCanvas()
    this.isAutoplayed ? this.startSubtitlePolling() : this.findSubtitles()
    this.autoplayedFullscreenCheck()
    this.startDelayedVideo()
  }

  startEventListeners() {
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

  autoplayedFullscreenCheck() {
    this.fullscreenCheckInterval = setInterval(() => {
      if (!this.isAutoplayed) return
      const rect = this.video.getBoundingClientRect()
      const closerToOriginal = (Math.abs(Math.round(rect.height - this.video.offsetHeight)) < (Math.abs(Math.round(rect.height - window.innerHeight)) - 10)) && (Math.abs(Math.round(rect.width - this.video.offsetWidth)) < (Math.abs(Math.round(rect.width - window.innerWidth)) - 10))
      if (closerToOriginal) {
        this.isAutoplayed = false
        clearInterval(this.fullscreenCheckInterval)
        this.stopDelayedVideo()
      }
    }, 250)
  }

  setupCanvas() {
    if ((!document.fullscreenElement && !this.isAutoplayed) || !this.video) return
    this.container = document.createElement('div')
    this.container.className = 'video-delay-container'
    this.canvas = document.createElement('canvas')
    this.canvas.className = 'video-delay-canvas'
    this.offscreenCanvas = new OffscreenCanvas(1, 1)
    this.subtitleOverlay = document.createElement('canvas')
    this.subtitleOverlay.className = 'subtitle-delay-canvas'
    this.video.style.opacity = '0'
    this.canvas.style.opacity = '1'
    if (!this.canvas) return
    this.context = this.canvas.getContext('2d', { 
      alpha: false,
      willReadFrequently: false
    })
    this.offscreenContext = this.offscreenCanvas.getContext('2d', {
      alpha: false,
      willReadFrequently: false
    })
    if (!this.context) return
    this.subtitleContext = this.subtitleOverlay.getContext('2d', {
      alpha: true
    })
    if (this.video.parentNode) {
      this.video.parentNode.insertBefore(this.container, this.video)
      this.container.appendChild(this.video)
      this.container.appendChild(this.canvas)
      this.container.appendChild(this.subtitleOverlay)
    }
    if (this.video.videoWidth && this.video.videoHeight) {
      this.canvas.width = this.video.videoWidth
      this.canvas.height = this.video.videoHeight
    } else {
      this.canvas.width = this.video.offsetWidth || 640
      this.canvas.height = this.video.offsetHeight || 360
    }
    const dpr = window.devicePixelRatio || 1
    this.subtitleOverlay.width = (this.video.offsetWidth || window.innerWidth) * dpr
    this.subtitleOverlay.height = (this.video.offsetHeight || window.innerHeight) * dpr
    this.subtitleOverlay.style.width = `${this.video.offsetWidth || window.innerWidth}px`
    this.subtitleOverlay.style.height = `${this.video.offsetHeight || window.innerHeight}px`
    if (this.subtitleContext) {
      this.subtitleContext.scale(dpr, dpr)
      this.subtitleContext.textRendering = 'geometricPrecision'
      this.subtitleContext.fontKerning = 'normal'
    }
    this.updateCanvasScale()
    this.context.imageSmoothingEnabled = false
    if (this.subtitleContext) this.subtitleContext.imageSmoothingEnabled = false
    if (this.offscreenContext) this.offscreenContext.imageSmoothingEnabled = false
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
        (this.canvas.width != this.video.videoWidth || this.canvas.height != this.video.videoHeight)) {
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
    const dpr = window.devicePixelRatio || 1
    this.subtitleOverlay.width = scaledWidth * dpr
    this.subtitleOverlay.height = scaledHeight * dpr
    this.subtitleOverlay.style.width = `${scaledWidth}px`
    this.subtitleOverlay.style.height = `${scaledHeight}px`
    if (this.subtitleContext) {
      this.subtitleContext.setTransform(1, 0, 0, 1, 0, 0)
      this.subtitleContext.scale(dpr, dpr)
      this.subtitleContext.textRendering = 'geometricPrecision'
      this.subtitleContext.fontKerning = 'normal'  
    }
  }

  updateCanvasDimensions() {
    if (!this.canvas || !this.video.videoWidth || !this.video.videoHeight) return
    this.updateCanvasScale()
  }

  handleVideoDataLoaded() {
    if (!this.video || !this.context || this.video.readyState < 3 || !this.delay) return
    const framePromise = this.captureFrame()
    if (framePromise) {
      framePromise.then(frame => {
        if (frame) {
          try {
            this.initialFrame = frame
            this.context.drawImage(frame.image, 0, 0, this.canvas.width, this.canvas.height)
          } catch (e) {
            // Ignore
          }
        }
      })
    }
  }

  captureFrame() {
    if (!this.video || (!this.video.videoWidth && !this.video.offsetWidth) || (!this.video.videoHeight && !this.video.offsetHeight) || this.video.readyState < 2) return null
    const captureTimestamp = performance.now()
    try {
      const options = {
        imageOrientation: 'none',
        premultiplyAlpha: 'premultiply',
        colorSpaceConversion: 'none'
      }
      return createImageBitmap(this.video, options).then(bitmap => {
        return {
          image: bitmap,
          timestamp: captureTimestamp
        }
      })
    } catch (e) {
      return Promise.resolve(null)
    }
  }

  async startDelayedVideo() {
    if (this.delayedVideo) return
    this.delayedVideo = true
    this.videoStartTime = performance.now()
    const animationLoop = async (timestamp) => {
      if (!this.delayedVideo) return
      const framePromise = this.captureFrame()
      if (framePromise) {
        const frame = await framePromise
        if (frame) {
          this.frameQueue.push(frame)
          this.processExpiredFrames(timestamp)
        }
      }
      if ((timestamp - this.videoStartTime >= this.delay) && this.frameQueue.length > 0) {
        const frameToShow = this.frameQueue[0]
        if (this.context && frameToShow && frameToShow.image) {
          this.context.drawImage(frameToShow.image, 0, 0, this.canvas.width, this.canvas.height)
          if (this.lastRenderedFrame && this.lastRenderedFrame != frameToShow && this.lastRenderedFrame.image) {
            this.lastRenderedFrame.image.close()
          }
          this.lastRenderedFrame = frameToShow
          if (this.subtitleContext) {
            this.subtitleContext.clearRect(0, 0, this.subtitleOverlay.width, this.subtitleOverlay.height)
            this.renderSubtitles(this.subtitleOverlay.width, this.subtitleOverlay.height)
          }
        }
      }
      requestAnimationFrame(animationLoop)
    }
    requestAnimationFrame(animationLoop)
    this.captureSubtitleData()
  }

  processExpiredFrames(timestamp) {
    const cutoffTime = timestamp - this.delay
    if (this.frameQueue.length > 0 && this.frameQueue[0].timestamp < cutoffTime) {
      const oldestFrame = this.frameQueue[0]
      if (oldestFrame.image && oldestFrame != this.lastRenderedFrame) {
        try {
          oldestFrame.image.close()
        } catch (e) {
          // Ignore
        }
      }
      this.frameQueue.shift()
    }
  }
      
  findSubtitles() {
    const captionElements = document.querySelectorAll('[class*="caption"]')
    if (captionElements.length > 0) {
      const visibleCaptions = Array.from(captionElements).filter(element => {
        const styles = window.getComputedStyle(element)
        return styles.display != 'none' && styles.visibility != 'hidden' && styles.opacity != '0'
      })
      const hasJwCaptions = visibleCaptions.some(element => 
        element.innerHTML.trim().includes('jw-reset')
      )
      if (!hasJwCaptions) return false
      this.subtitleElements = Array.from(visibleCaptions)
      this.startSubtitleTracking()
      return true
    }
    return false
  }

  startSubtitlePolling() {
    let subtitlesFound = false
    this.subtitlePollInterval = setInterval(() => {
      if (!this.delayedVideo || this.video.width != 0 || subtitlesFound) {
        clearInterval(this.subtitlePollInterval)
        this.subtitlePollInterval = null
        return
      }
      if (!subtitlesFound) {
        const found = this.findSubtitles()
        if (found) {
          subtitlesFound = true
        }
      }
    }, 100)
  }
  
  startSubtitleTracking() {
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
    const captureSubtitles = () => {
      if (!this.delayedVideo) return
      let lines = []
      let elementIndex = 0
      this.subtitleElements.forEach(element => {
        const html = element.innerHTML.trim()
        if (html) {
          let startIndex = 0
          while (true) {
            startIndex = html.indexOf('plaintext;">', startIndex)
            if (startIndex == -1) break
            startIndex += 'plaintext;">'.length
            const endIndex = html.indexOf('</div>', startIndex)
            if (endIndex == -1) break
            let text = html.substring(startIndex, endIndex)
            if (text.includes('&amp;')) text = text.replace(/&amp;/g, '&')
            if (text.match(/<[biu]>/)) {
              const parsedSegments = this.parseStyledText(text, elementIndex > 0)
              lines = lines.concat(parsedSegments)
            } else {                           
              text.split('\n').forEach(line => {
                if (line.trim()) {
                  lines.push({ 
                    text: line.trim(),
                    newline: true,
                    styles: { bold: false, italic: false, underlined: false }
                  })
                }
              })
            }
            startIndex = endIndex
            elementIndex++
          }
        }
      })
      this.currentSubtitleLines = lines
      this.scheduleSubtitleDelay()
      requestAnimationFrame(captureSubtitles)
    }
    requestAnimationFrame(captureSubtitles)
  }
  
  parseStyledText(text, needsNewline) {
    let currentText = ''
    let segments = []
    let currentSegment = { 
      text: currentText,
      newline: needsNewline,
      styles: { bold: false, italic: false, underlined: false }
    }
    for (let i = 0; i < text.length; i++) {
      if (text[i] == '<') {
        if (text.substring(i, i+3) == '<b>' || text.substring(i, i+3) == '<i>' || text.substring(i, i+3) == '<u>') {
          if (currentText) {
            this.pushSegments(segments, currentText, needsNewline, currentSegment)
            currentText = ''
            needsNewline = false
          }
          if (text.substring(i, i+3) == '<b>') currentSegment.styles.bold = true
          else if (text.substring(i, i+3) == '<i>') currentSegment.styles.italic = true
          else if (text.substring(i, i+3) == '<u>') currentSegment.styles.underlined = true
          i += 2
        } else if (text.substring(i, i+4) == '</b>' || text.substring(i, i+4) == '</i>' || text.substring(i, i+4) == '</u>') {
          if (currentText) {
            this.pushSegments(segments, currentText, needsNewline, currentSegment)
            currentText = ''
            needsNewline = false
          }
          if (text.substring(i, i+4) == '</b>') currentSegment.styles.bold = false
          else if (text.substring(i, i+4) == '</i>') currentSegment.styles.italic = false
          else if (text.substring(i, i+4) == '</u>') currentSegment.styles.underlined = false
          i += 3
        } else {
          currentText += text[i]
        }
      } else if (text[i] == '\n') {
        if (currentText) {
          this.pushSegments(segments, currentText, needsNewline, currentSegment)
          currentText = ''
        }
        needsNewline = true
      } else {
        currentText += text[i]
      }
    }
    if (currentText) {
      this.pushSegments(segments, currentText, needsNewline, currentSegment)
    }
    return segments.filter(segment => segment.text.trim())
  }
  
  pushSegments(segments, currentText, needsNewline, currentSegment) {
    if (needsNewline && currentText[0] == ' ') currentText = currentText.slice(1)
    segments.push({
      text: currentText,
      newline: needsNewline,
      styles: {
        bold: currentSegment.styles.bold,
        italic: currentSegment.styles.italic,
        underlined: currentSegment.styles.underlined
      }
    })
  }

  scheduleSubtitleDelay() {
    const currentSubtitleLines = this.currentSubtitleLines
    setTimeout(() => {
      this.delayedSubtitleLines = currentSubtitleLines
    }, this.delay)
  }

  renderSubtitles(overlayWidth, overlayHeight) {
    if (this.delayedSubtitleLines.length == 0 || !this.subtitleContext) return
    const dpr = window.devicePixelRatio || 1
    this.subtitleContext.clearRect(0, 0, this.subtitleOverlay.width, this.subtitleOverlay.height)
    this.subtitleContext.setTransform(1, 0, 0, 1, 0, 0)
    this.subtitleContext.scale(dpr, dpr)
    this.subtitleContext.imageSmoothingEnabled = false
    this.subtitleContext.save()
    const adjustedWidth = overlayWidth / dpr
    const adjustedHeight = overlayHeight / dpr
    const baselineY = Math.round(adjustedHeight * 0.865)
    const fontSize = Math.max(16, Math.round((44 / 1080) * adjustedHeight))
    const lineSpacing = Math.round(fontSize * 1.5)
    const padding = Math.round(fontSize * 0.3)
    this.subtitleContext.textAlign = 'center'
    this.subtitleContext.textBaseline = 'middle'
    this.subtitleContext.fontKerning = 'normal'
    this.subtitleContext.textRendering = 'geometricPrecision'
    const bgColor = 'rgba(0, 0, 0, 0.50)'
    const textColor = 'rgb(255, 255, 255)'
    const logicalLines = []
    let currentLine = []
    this.delayedSubtitleLines.forEach(segment => {
      if (segment.newline) {
        currentLine = [segment]
        logicalLines.push(currentLine)
      } else {
        if (currentLine.length == 0) {
          currentLine = [segment]
          logicalLines.push(currentLine)
        } else {
          currentLine.push(segment)
        }
      }
    })
    const totalLogicalLines = logicalLines.length
    const verticalPositions = Array(totalLogicalLines).fill(0).map((_, i) => Math.round(baselineY - (totalLogicalLines - 1 - i) * lineSpacing))
    logicalLines.forEach((lineSegments, lineIndex) => {
      const lineY = verticalPositions[lineIndex]
      let totalLineWidth = 0
      const segmentWidths = []
      lineSegments.forEach(segment => {
        let fontStyle = ''
        if (segment.styles.italic) fontStyle += 'italic '
        if (segment.styles.bold) fontStyle += 'bold '
        this.subtitleContext.font = `${fontStyle}${fontSize}px Helvetica, sans-serif`
        const textMetrics = this.subtitleContext.measureText(segment.text)
        const segmentWidth = Math.round(textMetrics.width)
        segmentWidths.push(segmentWidth)
        totalLineWidth += segmentWidth
      })
      const rectX = Math.round(adjustedWidth / 2 - totalLineWidth / 2 - padding + 4)
      const rectY = Math.round(lineY - fontSize / 1.75 - padding / 2)
      const rectWidth = Math.round(totalLineWidth + padding * 2 - 7)
      const rectHeight = Math.round(fontSize + padding - 1)
      this.subtitleContext.fillStyle = bgColor
      this.subtitleContext.fillRect(rectX, rectY, rectWidth, rectHeight)
      let currentX = adjustedWidth / 2 - totalLineWidth / 2
      lineSegments.forEach((segment, segmentIndex) => {
        const segmentText = segment.text
        const segmentWidth = segmentWidths[segmentIndex]
        let fontStyle = ''
        if (segment.styles.italic) fontStyle += 'italic '
        if (segment.styles.bold) fontStyle += 'bold '
        this.subtitleContext.font = `${fontStyle}${fontSize}px Helvetica, sans-serif`
        this.subtitleContext.textAlign = 'left'
        this.subtitleContext.fillStyle = textColor
        this.subtitleContext.fillText(segmentText, Math.round(currentX), lineY)
        if (segment.styles.underlined) {
          this.subtitleContext.beginPath()
          const underlineY = Math.round(lineY + fontSize * 0.34)
          this.subtitleContext.moveTo(Math.round(currentX), underlineY)
          this.subtitleContext.lineTo(Math.round(currentX + segmentWidth), underlineY)
          this.subtitleContext.lineWidth = Math.max(1, Math.round(fontSize * 0.05))
          this.subtitleContext.strokeStyle = textColor
          this.subtitleContext.stroke()
        }
        currentX += segmentWidth
      })
      this.subtitleContext.textAlign = 'center'
    })
    this.subtitleContext.restore()
  }

  stopDelayedVideo() {
    this.delayedVideo = false
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
              if (value != undefined && value != null) {
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
      if (frame && frame.image) {
        try {
          frame.image.close()
        } catch (e) {
          // Ignore
        }
      }
    }
    this.frameQueue = []
    if (this.initialFrame && this.initialFrame.canvas) {
      this.initialFrame.canvas.width = 0
      this.initialFrame.canvas.height = 0
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
    this.subtitleOverlay = null
    this.subtitleContext = null
    this.container = null
    this.videoStartTime = 0
    this.delay = 0
    if (this.wasAutoplayed) {
      clearInterval(this.fullscreenCheckInterval)
      this.fullscreenCheckInterval = null
      this.wasAutoplayed = false
      videoMonitor.stopVideoMonitor()
      videoMonitor.startVideoMonitor()
    }
  }
}

const videoMonitor = new VideoMonitor()