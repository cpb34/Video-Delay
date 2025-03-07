# Video Delay

Extension that seamlessly delays fullscreen video. Enjoy synced audio with YouTube, Twitch, Anime sites, and more!

## Installation Guide

### Chrome Web Store:
This extension is available on the [Chrome Web Store](https://chromewebstore.google.com/detail/video-delay/jljinpfbicnefmleipfhlikpcpoaefip) and can be installed like any other extension

### Load Unpacked:
This extension can be loaded into the browser with the following steps:
1. Download and unzip `Video Delay v1.1.1`
2. Visit the browser extensions page and turn on Developer mode
3. Click "Load unpacked"
4. Select the unzipped folder

## Usage
Input the desired delay in milliseconds and turn the video delay on. It's that easy!

## Release Notes

**v1.1.1** - Minor storage bug fix

**v1.1.0** - Subtitle delay support for videos using the JW Player

**v1.0** - Video delay and UI foundation

## Limitations

- Video delay is only active while fullscreen
- Subtitle delay is unsupported for videos not using the JW Player
- Subtitles are currently burned into the delayed video and are not their own dedicated layer, thus the subtitle quality scales with video resolution and is not fixed as high quality
- Having browser graphics acceleration enabled can result in screen tearing with TVs
- DRM content is unsupported (use OBS fullscreen preview to delay the entire screen—correctly doing this is complicated)

## Contributions

If you would like to contribute, feel free to do so! While this release has everything I need, if you would like to add features, optimize the code to reduce CPU/RAM usage, or fix unnoticed bugs, I welcome you to do so! 
