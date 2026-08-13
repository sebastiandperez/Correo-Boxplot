import { createPinia } from 'pinia'
import { createRenderer, defineComponent, h } from 'vue'
import { describe, expect, it } from 'vitest'

import { useRuntimeStore } from '../app/stores/runtime'

interface HostNode {
  children: HostNode[]
  parent: HostNode | null
  props: Record<string, unknown>
  text: string
  type: string
}

function hostNode(type: string, text = ''): HostNode {
  return { children: [], parent: null, props: {}, text, type }
}

function textContent(node: HostNode): string {
  return `${node.text}${node.children.map(textContent).join('')}`
}

const renderer = createRenderer<HostNode, HostNode>({
  patchProp(element, key, _previous, next) {
    if (next === null) {
      delete element.props[key]
      return
    }

    element.props[key] = next
  },
  insert(child, parent, anchor) {
    child.parent = parent
    const anchorIndex = anchor ? parent.children.indexOf(anchor) : -1

    if (anchorIndex === -1) {
      parent.children.push(child)
    } else {
      parent.children.splice(anchorIndex, 0, child)
    }
  },
  remove(child) {
    const parent = child.parent
    if (!parent) return

    const index = parent.children.indexOf(child)
    if (index >= 0) parent.children.splice(index, 1)
    child.parent = null
  },
  createElement(type) {
    return hostNode(type)
  },
  createText(text) {
    return hostNode('#text', text)
  },
  createComment(text) {
    return hostNode('#comment', text)
  },
  setText(node, text) {
    node.text = text
  },
  setElementText(node, text) {
    node.children = []
    node.text = text
  },
  parentNode(node) {
    return node.parent
  },
  nextSibling(node) {
    const parent = node.parent
    if (!parent) return null

    const index = parent.children.indexOf(node)
    return parent.children[index + 1] ?? null
  },
})

const RuntimeProbe = defineComponent({
  name: 'RuntimeProbe',
  setup() {
    const runtime = useRuntimeStore()

    return () =>
      h(
        'p',
        `Local: ${runtime.local} · Auth: ${runtime.auth} · Network: ${runtime.connectivity}`,
      )
  },
})

describe('frontend bootstrap', () => {
  it('mounts Vue, initializes Pinia and renders application state', () => {
    const root = hostNode('root')

    renderer.createApp(RuntimeProbe).use(createPinia()).mount(root)

    expect(textContent(root)).toContain(
      'Local: opening · Auth: anonymous · Network: offline',
    )
  })
})
