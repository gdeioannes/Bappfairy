import cheerio from 'cheerio'
import HTMLtoJSX from '../utils/htmltojsx'
import base32 from 'base32'
import path from 'path'
import statuses from 'statuses'
import uglify from 'uglify-js'
import { promises as fs } from 'fs'
import { mkdirp } from 'fs-extra'
import raw from '../raw'
import Writer from './writer'

import {
  encapsulateCSS,
  escape,
  freeLint,
  freeText,
  Internal,
  splitWords,
  upperFirst,
  absoluteHref,
} from '../utils'

const _ = Symbol('_ViewWriter')
const htmltojsx = new HTMLtoJSX({ createClass: false })

const flattenChildren = (children = [], flatten = []) => {
  children.forEach((child) => {
    flattenChildren(child[_].children, flatten)
  })

  flatten.push(...children)

  return flatten
}

const dotRelative = (fromPath, toPath) => {
  const result = path.relative(fromPath, toPath).replace(/\\/g, '/')
  return result.startsWith('.') ? result : `./${result}`
}

@Internal(_)
class ViewWriter extends Writer {
  static async writeAll(viewWriters, dir, ctrlsDir) {
    await mkdirp(dir)

    const indexFilePath = `${dir}/index.js`
    const helpersFilePath = `${dir}/helpers.js`
    const childFilePaths = [indexFilePath, helpersFilePath]

    const writingViews = viewWriters.map(async (viewWriter) => {
      const filePaths = await viewWriter.write(dir, ctrlsDir)
      childFilePaths.push(...filePaths)
    })

    const index = flattenChildren(viewWriters
      .filter((viewWriter) => viewWriter.folder == '.'))
        .sort(ViewWriter.compare)
        .map((viewWriter) => (
          `export { default as ${viewWriter.className} } from './${viewWriter.className}'`
        )).join('\n')

    const writingIndex = fs.writeFile(indexFilePath, freeLint(index))
    const writingHelpers = fs.writeFile(helpersFilePath, raw.viewHelpers)

    await Promise.all([
      ...writingViews,
      writingIndex,
      writingHelpers,
    ])

    return childFilePaths
  }

  static removeDupChildren(viewWriters) {
    const dups = new Set()
    viewWriters.sort(ViewWriter.compare).forEach((viewWriter) => {
      viewWriter.removeDupChildren(dups)
    })
  }

  static compare(writerA, writerB) {
    const a = writerA.key
    const b = writerB.key
    return (a < b) ? -1 : (a > b) ? 1 : 0
  }

  get encapsulateCSS() {
    return this[_].encapsulateCSS
  }

  set encapsulateCSS(encapsulateCSS) {
    this[_].encapsulateCSS = !!encapsulateCSS
  }

  get folder() {
    return this[_].folder
  }

  set folder(folder) {
    this[_].folder = String(folder)
  }

  get baseUrl() {
    return this[_].baseUrl
  }

  set baseUrl(baseUrl) {
    this[_].baseUrl = String(baseUrl)
  }

  get children() {
    return this[_].children.slice()
  }

  set name(name) {
    if (!isNaN(Number(name))) {
      name = statuses[name]
    }

    const words = splitWords(name)

    Object.assign(this[_], {
      ctrlClassName: words.concat('controller').map(upperFirst).join(''),
      className: words.concat('view').map(upperFirst).join(''),
      elName: words.map(word => word.toLowerCase()).join('-'),
      name:  words.concat('view').map(word => word.toLowerCase()).join('-'),
    })
  }

  get name() {
    return this[_].name
  }

  get ctrlClassName() {
    return this[_].ctrlClassName
  }

  get className() {
    return this[_].className
  }

  get elName() {
    return this[_].elName
  }

  get key() {
    return `${this.folder}/${this.className}`
  }

  set html(html) {
    if (!html) {
      this[_].html = ''
      this[_].children = []
      return
    }

    const children = this[_].children = []
    const $ = cheerio.load(html)

    // Encapsulate styles
    if (this.encapsulateCSS) {
      $('style').each((i, el) => {
        const $el = $(el)
        const html = $el.html()
        const css = encapsulateCSS(html, this.srouce)
  
        $el.html(css)
      })
    }

    $('*').each((i, el) => {
      const $el = $(el)
      let className = $el.attr('class')

      if (this.encapsulateCSS && className && !/af-class-/.test(className)) {
        className = className.replace(/([\w_-]+)/g, 'af-class-$1')

        switch (this.source) {
          case 'webflow':
            className = className
              .replace(/af-class-w-/g, 'w-')
            break
          case 'sketch':
            className = className
              .replace(/af-class-anima-/g, 'anima-')
              .replace(/af-class-([\w_-]+)an-animation([\w_-]+)/g, '$1an-animation$2')
            break
          default:
            className = className
              .replace(/af-class-w-/g, 'w-')
              .replace(/af-class-anima-/g, 'anima-')
              .replace(/af-class-([\w_-]+)an-animation([\w_-]+)/g, '$1an-animation$2')
        }

        $el.attr('class', className)
      }

      let href = $el.attr('href')
      if (href) {
        $el.attr('href', absoluteHref(href));
      }

      let src = $el.attr('src')
      if (src) {
        $el.attr('src', absoluteHref(src));
      }
    })

    let el = $('[af-el]')[0]

    while (el) {
      const $el = $(el)
      const elName = $el.attr('af-el')
      const $afEl = $(`<af-${elName}></af-${elName}>`)

      for (const name of ['af-sock', 'af-repeat']) {
        $afEl.attr(name, $el.attr(name))
        $el.attr(name, null)
      }
      $el.attr('af-el', null)
      $afEl.insertAfter($el)
      $el.remove()

      const child = new ViewWriter({
        name: elName,
        html: $.html($el),
        folder: this.folder,
        baseUrl: this.baseUrl,
      })

      children.push(child)
      el = $('[af-el]')[0]
    }

    // Apply ignore rules AFTER child elements were plucked
    $('[af-ignore]').remove()
    // Empty inner HTML
    $('[af-empty]').html('').attr('af-empty', null)

    this[_].scripts = []

    // Set inline scripts. Will be loaded once component has been mounted
    $('script').each((i, script) => {
      const $script = $(script)
      const src = $script.attr('src')
      const type = $script.attr('type')
      const isAsync = !!$script.attr('async')

      // We're only interested in JavaScript script tags
      if (type && !/javascript/i.test(type)) return

      if (src) {
        this[_].scripts.push({
          type: 'src',
          body: absoluteHref(src),
          isAsync,
        })
      }
      else {
        this[_].scripts.push({
          type: 'code',
          body: $script.html(),
          isAsync,
        })
      }

      $script.remove()
    })

    // Wrapping with .af-view will apply encapsulated CSS
    const $body = $('body')
    const $afContainer = $('<span class="af-view"></span>')

    $afContainer.append($body.contents())
    $afContainer.prepend('\n  ')
    $afContainer.append('\n  ')
    $body.append($afContainer)

    html = $body.html()

    this[_].html = html

    const sockets = this[_].sockets = {}

    const getSock = ($el) => {
      const sock = $el.attr('af-sock').trim()
      if (!/^[a-z_-][0-9a-z_-]*$/.test(sock)) {
        throw `invalid sock '${sock}' in '${this.name}' view`
      }
      return sock.replace(/_/g, '-')
    }

    // Build the socket tree
    $('[af-sock]').each((_, el) => {
      const $el = $(el)
      const sock = getSock($el)

      const group = $el.parents('[af-sock]').toArray().reverse()
        .reduce((acc, el) => acc[getSock($(el))].sockets, sockets)
      group[sock] = {
        type: $el[0].name,
        repeat: ($el.attr('af-repeat') || '').trim(),
        sockets: {},
      }
    })

    // Encode socket data into the tag name
    $('[af-sock]').each((i, el) => {
      const $el = $(el)
      const sock = getSock($el)

      const repeat = ($el.attr('af-repeat') || '').trim()
      if (!/^[?*+]?$/.test(repeat)) {
        throw `invalid repeat '${repeat}' for socket '${sock}' in '${this.name}' view`
      }

      $el.attr('af-sock', null)
      $el.attr('af-repeat', null)

      const data = { sock, repeat }
      const encoded = base32.encode(JSON.stringify(data))
      el.tagName += `-af-sock-${i}-${encoded}`
    })

    // Refetch modified html
    html = $body.html()

    // Transforming HTML into JSX
    let jsx = htmltojsx.convert(html).trim()
    // Bind controller to view
    this[_].jsx = bindJSX(jsx, children)
  }

  set wfData(dataAttrs) {
    for (let [key, value] of Object.entries(dataAttrs)) {
      if (/^wf/.test(key)) {
        this[_].wfData.set(key, value)
      }
    }
  }

  get scripts() {
    return this[_].scripts ? this[_].scripts.slice() : []
  }

  get styles() {
    return this[_].styles.slice()
  }

  get html() {
    return this[_].html
  }

  get wfData() {
    return this[_].wfData
  }

  get jsx() {
    return this[_].jsx
  }

  get sockets() {
    return this[_].sockets && [...this[_].sockets]
  }

  get source() {
    return this[_].source
  }

  set source(source) {
    this[_].source = String(source)
  }

  constructor(options) {
    super()

    this[_].children = []
    this[_].styles = options.styles || []
    this[_].wfData = new Map()

    this.name = options.name
    this.html = options.html
    this.source = options.source
    this.folder = options.folder
    this.encapsulateCSS = options.encapsulateCSS
  }

  removeDupChildren(dups) {
    this[_].children = this[_].children.filter((child) => {
      const key = child.key
      if (!dups.has(key)) {
        dups.add(key)
        return true
      }
      return false // dup found, skip it
    })
    this[_].children.forEach((child) => {
      child.removeDupChildren(dups)
    })
  }

  async write(dir, ctrlsDir) {
    const filePath = path.normalize(`${dir}/${this.folder}/${this.className}.js`)
    const childFilePaths = [filePath]

    await fs.mkdir(path.dirname(filePath), { recursive: true })

    const writingChildren = this[_].children.map(async (child) => {
      const filePaths = await child.write(dir, ctrlsDir)
      childFilePaths.push(...filePaths)
    })

    const writingSelf = fs.writeFile(filePath, this[_].compose(dir, ctrlsDir))

    await Promise.all([
      ...writingChildren,
      writingSelf,
    ])

    return childFilePaths
  }

  setStyle(href, content) {
    let type
    let body

    if (href) {
      type = 'href'
      body = absoluteHref(href)
    }
    else {
      type = 'sheet'
      body = content
    }

    const exists = this[_].styles.some((style) => {
      return style.body == body
    })

    if (!exists) {
      this[_].styles.push({ type, body })
    }
  }

  _compose(dir, ctrlsDir) {
    const helpersPath = dotRelative(this.folder, 'helpers')
    const ctrlPath = dotRelative(
      `${dir}/${this.folder}`,
      `${ctrlsDir}/${this.folder}/${this.ctrlClassName}`,
    )
    return freeLint(`
      import React from 'react'
      import { createScope, prefetch, loadScripts } from '${helpersPath}'
      ==>${this[_].composeChildImports()}<==
      ==>${this[_].composeSocks()}<==

      const scripts = [
        ==>${this[_].composeScriptsDeclerations()}<==
      ]
      scripts.forEach(prefetch)

      let Controller

      export class ${this.className} extends React.Component {
        static get Controller() {
          if (Controller) return Controller

          try {
            Controller = require('${ctrlPath}')
            Controller = Controller.default || Controller

            return Controller
          }
          catch (e) {
            if (e.code == 'MODULE_NOT_FOUND') {
              Controller = ${this.className}

              return Controller
            }

            throw e
          }
        }

        componentDidMount() {
          ==>${this[_].composeWfDataAttrs()}<==

          loadScripts(scripts)
        }

        render() {
          return createScope(this.props.children, proxy => (
            <span>
              ==>${this[_].composeStyleImports()}<==
              ==>${this.jsx}<==
            </span>
          ))
        }
      }

      export default ${this.className}
    `)
  }

  _composeStyleImports() {
    const hrefs = this[_].styles.map(({ type, body }) => {
      return type == 'href' && body
    }).filter(Boolean)

    const sheets = this[_].styles.map(({ type, body }) => {
      return type == 'sheet' && body
    }).filter(Boolean)

    let css = ''

    css += hrefs.map((href) => {
      return `@import url(${href});`
    }).join('\n')

    css += '\n\n'

    css += sheets.map((sheet) => {
      return sheet
    }).join('\n\n')

    const imports = escape(css.trim())
    if (!imports) {
      return ''
    }

    return freeText(`
      <style dangerouslySetInnerHTML={{ __html: \`
        ==>${imports}<==
      \` }} />
    `)
  }

  _composeSocks() {
    const sock = {}
    const collectHints = (sockets) =>
      Object.entries(sockets).map(([socketName, props]) => {
        const ident = socketName.replace(/-/g, '_')
        sock[ident] = socketName
        const comment = props.repeat ? `  // repeat='${props.repeat}'` : ''
        if (Object.keys(props.sockets).length === 0) {
          return `<${props.type} af-sock={sock.${ident}} />${comment}`
        }
        const text = freeText(`
          <${props.type} af-sock={sock.${ident}}>${comment}
            ==>${collectHints(props.sockets)}<==
          </${props.type}>
        `)
        return `\n${text}\n`
      }).join('\n')

    const hintText = freeText(`
      All proxies defined by this view:

      ==>${collectHints(this[_].sockets)}<==
    `).replace(/\n\n\n/g, '\n\n')

    const sockText = Object.entries(sock).sort().map(([ident, name]) =>
      `${ident}: "${name}",`).join('\n')

    return freeText(`
      /*
        ==>${hintText}<==
      */

      export const sock = Object.freeze({
        ==>${sockText}<==
      })
    `)
  }

  _composeChildImports() {
    const imports = this[_].children.map((child) => {
      return `import ${child.className} from './${child.className}'`
    })

    return [...new Set(imports), ''].join('\n')
  }

  _composeScriptsDeclerations() {
    return this[_].scripts.map((script) => {
      if (script.type == 'src') {
        return `{ src: "${script.body}", isAsync: ${!!script.isAsync} },`
      }

      const minified = uglify.minify(script.body).code
      // Unknown script format ??? fallback to maxified version
      const code = minified || script.body

      return `{ body: "${escape(code)}", isAsync: ${!!script.isAsync} },`
    }).join('\n')
  }

  _composeWfDataAttrs() {
    if (!this[_].wfData.size) {
      return '/* View has no WebFlow data attributes */'
    }

    const lines = [
      "const htmlEl = document.querySelector('html')",
    ]

    for (let [attr, value] of this[_].wfData) {
      lines.push(`htmlEl.dataset['${attr}'] = '${value}'`)
    }

    return lines.join('\n')
  }
}

function bindJSX(jsx, children = []) {
  children.forEach((child) => {
    jsx = jsx.replace(
      new RegExp(`af-${child.elName}`, 'g'),
      `${child.className}.Controller`
    )
  })

  // ORDER MATTERS
  return jsx
    // Open close
    .replace(
      /<([\w._-]+)-af-sock-(\d+)-(\w+)(.*?)>([^]*)<\/\1-af-sock-\2-\3>/g, (
      match, el, _index, encoded, attrs, children
    ) => {
      const { sock, repeat } = JSON.parse(base32.decode(encoded))
      // If there are nested sockets
      return /<[\w._-]+-af-sock-\d+-\w+/.test(children) ? (
        `{proxy('${sock}', '${repeat}', props => <${el} ${mergeProps(attrs)}>{createScope(props.children, proxy => <React.Fragment>${bindJSX(children)}</React.Fragment>)}</${el}>)}`
      ) : (
        `{proxy('${sock}', '${repeat}', props => <${el} ${mergeProps(attrs)}>{props.children ? props.children : <React.Fragment>${children}</React.Fragment>}</${el}>)}`
      )
    })
    // Self closing
    .replace(
      /<([\w._-]+)-af-sock-\d+-(\w+)(.*?)\/>/g, (
      match, el, encoded, attrs
    ) => {
      const { sock, repeat } = JSON.parse(base32.decode(encoded))
      return `{proxy('${sock}', '${repeat}', props => <${el} ${mergeProps(attrs)}>{props.children}</${el}>)}`
    })
}

// Merge props along with class name
function mergeProps(attrs) {
  attrs = attrs.trim()

  if (!attrs) {
    return '{...props}'
  }

  let className = attrs.match(/className="([^"]+)"/)

  if (!className) {
    return `${attrs} {...props}`
  }

  className = className[1]
  attrs = attrs.replace(/ ?className="[^"]+"/, '')

  return `${attrs} {...{...props, className: \`${className} $\{props.className || ''}\`}}`.trim()
}

export default ViewWriter
