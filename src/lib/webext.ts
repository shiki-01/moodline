type WebExtensionGlobal = {
  browser?: typeof chrome
  chrome?: typeof chrome
}

const g = globalThis as WebExtensionGlobal

export const webext: typeof chrome = g.browser ?? g.chrome ?? (() => {
  throw new Error('WebExtension API is not available in this context')
})()
