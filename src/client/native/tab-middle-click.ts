/**
 * Middle-click close over the plugin's tabs in DSH's native right Sidebar.
 *
 * DSH's own tab strip has no button-1 handling: its tab element binds
 * pointerdown (drag), click (activate), keydown (focus) and contextmenu (the
 * menu), so the middle-click close every other tab strip in the product
 * offers is absent from the native column. The plugin renders a native tab's
 * BODY and its TITLE, never the chip around them, so the gesture is restored
 * from the one part it owns — the title chip.
 *
 * The chip publishes two things: an ownership marker carrying its native tab
 * id, and the tab's own `actions.close()`. The host hands `actions` to the
 * title seat as well as the body (0.1.7 rc.1 and rc.2 alike — `TabSlot` passes
 * the same `tabActions` to both seats), and that action is
 * `navigator.closeIn(sessionId, tabId)`, the same call the host's × button
 * ends in. So a close is session-exact and needs no closability guess.
 *
 * The marker is the ownership test, and it has to be the plugin's own: the
 * host's `data-dockkit-tab` names the tab but says nothing about who rendered
 * it, and the title slot's own `data-sidebar-right-tab` only exists from rc.2
 * on (it is absent on the rc.1 baseline). A tab whose chip never marked it —
 * the built-in guide, the host's terminal — resolves to nothing and keeps
 * every bit of its native behaviour.
 */

/** The docking kit's attribute on one strip chip (the whole clickable tab). */
const DOCK_TAB_ATTRIBUTE = 'data-dockkit-tab'

/** The kit's attribute on a floating panel's header (its title row). */
const FLOAT_HEADER_ATTRIBUTE = 'data-dockkit-float-grip'

/**
 * Where a press may land: the strip chip, or a floating panel's HEADER — never
 * the panel at large, whose body hosts editors and web content where the
 * middle button means paste / open-in-background.
 */
const HIT_NODE_SELECTOR = `[${DOCK_TAB_ATTRIBUTE}], [${FLOAT_HEADER_ATTRIBUTE}]`

/**
 * The marker a plugin tab's title chip stamps: ownership plus the native tab
 * id the close was published under. The host's `data-dockkit-tab` cannot
 * serve this purpose — it names the tab but is also on host tabs.
 */
export const NATIVE_TAB_MARKER = 'data-dsh-better-sidebar-native-tab'

/**
 * How far (CSS pixels) a middle press may drift before it counts as a drag. A
 * drag can end on the same tab and the kit moves the tab with it, so closing
 * then would punish a gesture the user aimed at moving the tab.
 */
const DRAG_SLOP = 4

/** One outstanding middle press. */
interface Press {
  readonly id: string
  /** Where the release must land (see {@link hitOf}). */
  readonly node: Element
  readonly x: number
  readonly y: number
}

/** One plugin tab a press resolved to. */
interface Hit {
  readonly id: string
  readonly node: Element
}

/** Middle-click close over the plugin's native tabs. */
export interface NativeTabMiddleClick {
  /**
   * Publish one live tab's close action; called by that tab's title chip.
   * @param tabId - the native tab id the chip is rendered for.
   * @param close - the action ending the tab in its own session.
   * @returns a disposer unpublishing the action (the chip's effect cleanup).
   */
  register(tabId: string, close: () => void): () => void
  /** Stop listening; the chips this controller served are gone. */
  dispose(): void
}

/**
 * Resolve an event target to a plugin tab: the chip itself, or — for the
 * parts of a strip tab the chip does not cover (its padding, the gap before
 * the ×) — the enclosing kit box that contains one. The chip's marker is the
 * ownership test and the identity: a box with no marked chip belongs to the
 * host (the built-in guide, the host's terminal) and resolves to undefined.
 * @param target - the event target.
 * @returns the tab id and the node a release must land in, or undefined.
 */
function hitOf(target: EventTarget | null): Hit | undefined {
  const element = target as Element | null
  if (element === null || typeof element.closest !== 'function') return undefined
  // The kit's own box for this tab: the strip chip, or the floating header.
  // A press anywhere else (a pane body, the page) has no such box.
  const node = element.closest(HIT_NODE_SELECTOR)
  if (node === null) return undefined
  const chip = element.closest(`[${NATIVE_TAB_MARKER}]`) ?? node.querySelector(`[${NATIVE_TAB_MARKER}]`)
  const tabId = chip?.getAttribute(NATIVE_TAB_MARKER)
  if (tabId === null || tabId === undefined || tabId === '') return undefined
  return { id: tabId, node }
}

/**
 * Create the middle-click controller for one client activation.
 *
 * Listeners are attached at creation and removed by {@link
 * NativeTabMiddleClick.dispose}; the returned controller is one per activation
 * (never a module singleton), so a disposed plugin leaves no document-level
 * listener behind.
 * @returns the controller the native title chips publish their closes to.
 */
export function createNativeTabMiddleClick(): NativeTabMiddleClick {
  const handlers = new Map<string, () => void>()
  let press: Press | undefined
  const clear = (): void => { press = undefined }

  const onDown = (event: Event): void => {
    const down = event as MouseEvent
    // Any other button starts a different gesture, so an outstanding middle
    // press can never settle.
    if (down.button !== 1) { clear(); return }
    const hit = hitOf(down.target)
    if (hit === undefined) { clear(); return }
    // `preventDefault` disarms Chrome's middle-click autoscroll; the
    // `stopPropagation` keeps the kit's drag tracking (bound to pointerdown)
    // from turning this press into a tab drag. It cannot reach that handler
    // when the press lands outside the plugin's chip, but a drag only commits
    // past a movement threshold the release check below keeps out.
    down.preventDefault()
    down.stopPropagation()
    press = { id: hit.id, node: hit.node, x: down.clientX, y: down.clientY }
  }

  const onUp = (event: Event): void => {
    const up = event as MouseEvent
    if (up.button !== 1) return
    const held = press
    clear()
    if (held === undefined) return
    // Release-position semantics (VS Code microsoft/vscode#101028, Chrome
    // crbug/40679924): the close only settles over the pressed tab, and the
    // tab must still be in the document — it may have been closed under the
    // press. A release that drifted past the slop was a drag.
    if (!held.node.isConnected || !held.node.contains(up.target as Node)) return
    if (Math.abs(up.clientX - held.x) > DRAG_SLOP || Math.abs(up.clientY - held.y) > DRAG_SLOP) return
    handlers.get(held.id)?.()
  }

  const listening: Array<[EventTarget, string, EventListener]> = []
  const listen = (target: EventTarget, type: string, listener: EventListener): void => {
    // Capture, so the press is consumed before the kit's own pointerdown
    // handler (and before anything inside a pane body sees the button).
    target.addEventListener(type, listener, true)
    listening.push([target, type, listener])
  }
  let disposed = false
  if (typeof document !== 'undefined' && typeof window !== 'undefined') {
    // Pointer events carry the press the kit's own handler would otherwise
    // turn into a tab drag; the mouse pair is the fallback for engines
    // without PointerEvent (and for the jsdom lane).
    if (typeof (window as { PointerEvent?: unknown }).PointerEvent === 'function') {
      listen(document, 'pointerdown', onDown)
      listen(document, 'pointerup', onUp)
      listen(document, 'pointercancel', clear)
    }
    listen(document, 'mousedown', onDown)
    listen(document, 'mouseup', onUp)
    listen(window, 'blur', clear)
  }

  return {
    register(tabId, close) {
      handlers.set(tabId, close)
      return () => {
        // A chip that re-renders for the same tab must not unpublish a newer
        // action it no longer owns.
        if (handlers.get(tabId) === close) handlers.delete(tabId)
      }
    },
    dispose() {
      if (disposed) return
      disposed = true
      handlers.clear()
      clear()
      for (const [target, type, listener] of listening) target.removeEventListener(type, listener, true)
      listening.length = 0
    },
  }
}

/** The attributes one title chip stamps to claim its tab. */
export function nativeTabMarker(tabId: string): Record<string, string> {
  return { [NATIVE_TAB_MARKER]: tabId }
}
