document.addEventListener('DOMContentLoaded', () => {
  const delayInput = document.getElementById('delay')
  const toggleButton = document.getElementById('toggle')
  const toggleText = toggleButton.querySelector('.toggle-text')
  const modeToggle = document.getElementById('mode-toggle')
  const delayType = document.getElementById('delay-type')

  function applyDelayToActiveTab(delay, enabled) {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'setDelay',
          mode: modeToggle.textContent,
          delay: enabled && delay >= 0 ? delay : 0
        }, (response) => { if (chrome.runtime.lastError) {} })
      }
    })
  }

  function updateDelayType() {
    const mode = modeToggle.textContent
    delayType.textContent = mode
    modeToggle.className = mode.toLowerCase()
  }

  function saveAndApplySettings() {
    const isEnabled = toggleButton.classList.contains('active')
    const currentDelay = parseInt(delayInput.value) || 0
    
    chrome.storage.local.set({ 
      enabled: isEnabled,
      delay: currentDelay,
      mode: modeToggle.textContent
    }, function() { applyDelayToActiveTab(currentDelay, isEnabled) })
  }
  
  chrome.storage.local.get(['delay', 'enabled', 'mode'], function(result) {
    if (result.delay != undefined) delayInput.value = result.delay

    if (result.mode != undefined) {
      modeToggle.textContent = result.mode
      updateDelayType()
    }

    if (result.enabled != undefined) {
      toggleButton.classList.toggle('active', result.enabled)
      toggleText.textContent = result.enabled ? 'ON' : 'OFF'
    }
  })

  modeToggle.addEventListener('click', () => {
    const newMode = modeToggle.textContent == 'Video' ? 'Audio' : 'Video'
    modeToggle.textContent = newMode
    updateDelayType()
    saveAndApplySettings()
  })

  toggleButton.addEventListener('click', () => {
    const isEnabled = toggleButton.classList.toggle('active')
    toggleText.textContent = isEnabled ? 'ON' : 'OFF'
    saveAndApplySettings()
  })

  delayInput.addEventListener('input', () => { saveAndApplySettings() })
})