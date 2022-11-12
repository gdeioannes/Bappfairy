/* eslint-disable */

import React from 'react'

const transformProxies = (children = []) => {
  children = [].concat(children).filter(Boolean)

  const proxies = {}

  React.Children.forEach(children, (child) => {
    const props = Object.assign({}, child.props)

    const name = props['af-sock'] || child.type
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

  return callback((name, repeat, callback) => {
    const props = proxies[name]
  
    if (props == null) {
      // no proxy - use default unless repeat is "?" or "*"
      if (/^[?*]$/.test(repeat)) return null
      return callback({})
    }

    if (!(props instanceof Array)) return callback(props)
    // 2 or more proxies - error unless repeat is "+" or "*"
    if (/^[+*]$/.test(repeat)) return props.map(callback)

    throw new Error(`too many (${props.length}) '${name}' proxies`)
  })
}

/* eslint-enable */
