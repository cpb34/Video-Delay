document.addEventListener('DOMContentLoaded', () => {
  const delayInput = document.getElementById('delay')
  const toggleButton = document.getElementById('toggle')
  const toggleText = toggleButton.querySelector('.toggle-text')

  function applyDelayToActiveTab(delay, enabled) {
    chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
      if (tabs[0] && tabs[0].id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'setDelay',
          delay: enabled ? delay : 0
        })
      }
    })
  }

  chrome.storage.local.get(['delay', 'enabled'], function(result) {
    if (result.delay !== undefined) {
      delayInput.value = result.delay
    }

    if (result.enabled !== undefined) {
      toggleButton.classList.toggle('active', result.enabled)
      toggleText.textContent = result.enabled ? 'ON' : 'OFF'
      
      if (result.enabled) {
        applyDelayToActiveTab(result.delay || 0, true)
      }
    }
  })

  toggleButton.addEventListener('click', () => {
    const isEnabled = toggleButton.classList.toggle('active')
    toggleText.textContent = isEnabled ? 'ON' : 'OFF'
    const currentDelay = parseInt(delayInput.value)
    chrome.storage.local.set({ 
      enabled: isEnabled,
      delay: currentDelay
    }, function() {
      applyDelayToActiveTab(currentDelay, isEnabled)
    })
  })

  delayInput.addEventListener('input', () => {
    const delay = parseInt(delayInput.value)
    const isEnabled = toggleButton.classList.contains('active')
    chrome.storage.local.set({ 
      delay: delay,
      enabled: isEnabled
    }, function() {
      applyDelayToActiveTab(delay, isEnabled)
    })
  })
})