/* eslint-disable */

const React = require('react')

exports.transformProxies = (children = []) => {
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

exports.createScope = (children, callback) => {
  const proxies = exports.transformProxies(children)

  return callback(proxies)
}

exports.map = (props, callback) => {
  if (props == null) return null
  if (!(props instanceof Array)) return callback(props)

  return props.map(callback)
}

/* eslint-enable */
