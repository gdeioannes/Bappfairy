/* eslint-disable */

import React from 'react'

const scriptStore = {}

class ProxyError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProxyError'
  }
}

const transformProxies = (children = []) => {
  children = [].concat(children).filter(Boolean)

  const proxies = {}

  React.Children.forEach(children, (child) => {
    const props = Object.assign({}, child.props)

    Object.defineProperties(props, {
      _used: { value: false, writable: true },
      _type: { value: child.type, writable: false },
    })

    const name = (props['af-sock'] || '').trim().replace(/_/g, '-')
    if (!name) {
      throw new ProxyError(`: missing af-sock= on <${child.type}>`)
    }
    delete props['af-sock']
    
    if (!proxies[name]) {
      proxies[name] = props
    }
    else if (!(proxies[name] instanceof Array)) {
      proxies[name] = [proxies[name], props]
    }
    else {
      proxies[name].push(props)
    }

    if (child.key != null) {
      props.key = child.key
    }

    if (child.ref != null) {
      props.ref = child.ref
    }
  })

  return proxies
}

export const createScope = (children, callback) => {
  const proxies = transformProxies(children)

  const result = callback((name, repeat, callback) => {
    const props = proxies[name]

    const call = (props) => {
      try {
        return callback(props, props._type)
      } catch (err) {
        if (err instanceof ProxyError) {
          // reconstruct namespace for proxy errors
          throw new ProxyError(`${name}.${err.message}`)
        }
        throw err
      }
    }

    // no proxy
    if (!props) {
      if (repeat === '!') {
        throw new ProxyError(`${name}: required proxy not found`)
      }
      if (/^[?*]$/.test(repeat)) return null
      return call({})
    }

    // mark proxy as recognised
    ((props instanceof Array) ? props : [props])[0]._used = true

    // single proxy
    if (!(props instanceof Array)) return call(props)
    // 2 or more proxies
    if (/^[+*]$/.test(repeat)) return props.map(call)

    throw new ProxyError(`${name}: too many proxies (${props.length})`)
  })

  // check for unrecognised proxies
  Object.entries(proxies).forEach(([name, props]) => {
    if (!((props instanceof Array) ? props : [props])[0]._used) {
      throw new ProxyError(`${name}: unrecognised proxy`)
    }
  })

  return result
}

export const prefetch = (script) => {
  if (script.body) return Promise.resolve(script.body)
  if (!script.src) return Promise.resolve('')

  if (!scriptStore[script.src]) {
    scriptStore[script.src] = fetch(script.src).then(r => r.text())
  }
  return scriptStore[script.src]
}

export const loadScripts = (scripts) => {
  const result = scripts.concat(null).reduce((active, next) =>
    Promise.resolve(active).then((active) => {
      const loading = prefetch(active).then((script) => {
        new Function(`
          with (this) {
            eval(arguments[0])
          }
        `).call(window, script)

        return next
      })

      return active.isAsync ? next : loading
    })
  )

  return Promise.resolve(result)
}

/*
 * Helper function to re-init the webflow.js code.
 *
 * This re-attaches event listeners to all elements
 * with animation triggers, among other things.
 * 
 * It might've to be called when a view is re-rendered after
 * new proxies have been added for animated elements.
 * Event listeners aren't attached to new elements automatically.
 */
export const reinitWebflow = () => {
  // Unregister event listeners of IX2
  window.Webflow?.require('ix2')?.destroy()

  // Re-initialize Webflow
  return loadScripts([
    { src: '/js/webflow.js', isAsync: false },
  ])
}

/* eslint-enable */
