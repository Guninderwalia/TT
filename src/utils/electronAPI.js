// Utility module to provide electron API access
// window.electron is set up by the preload (production) or injected by main.js (development)

export const getElectronAPI = () => {
  if (!window.electron) {
    throw new Error('window.electron is not available. Make sure you are running in Electron.');
  }
  return window.electron;
};
