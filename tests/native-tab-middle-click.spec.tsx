// @vitest-environment jsdom
/**
 * Middle-click close over the plugin's native tabs.
 *
 * The gesture is the plugin's, but the ownership test is the host's own
 * `data-sidebar-right-tab` plus the controller's registry — only a chip that
 * published a close can be closed, so a host tab keeps every bit of its
 * native behaviour. Semantics follow the plugin's own strip: the press is
 * recorded on middle mousedown (preventDefaulted to disarm Chrome's
 * autoscroll, stopPropagation to keep the kit's drag tracking out), and the
 * close settles on the first middle mouseup over that same tab — a release
 * elsewhere, or a drift past the slop, cancels.
 */
import { describe, expect, it, vi } from 'vitest'
import { createNativeTabMiddleClick, NATIVE_TAB_MARKER, nativeTabMarker } from '../src/client/native/tab-middle-click.ts'

/** One kit strip chip holding one plugin title element. */
function mountChip(input: { tabId: string; plugin?: boolean }): { tab: HTMLElement; chip: HTMLElement } {
  const tab = document.createElement('div')
  tab.setAttribute('data-dockkit-tab', input.tabId)
  tab.style.padding = '6px'
  document.body.append(tab)
  const chip = document.createElement('span')
  if (input.plugin !== false) chip.setAttribute(NATIVE_TAB_MARKER, input.tabId)
  chip.textContent = input.tabId
  tab.append(chip)
  return { tab, chip }
}

function mouse(target: EventTarget, type: string, button: number, x = 0, y = 0): MouseEvent {
  const event = new MouseEvent(type, { bubbles: true, cancelable: true, button, clientX: x, clientY: y })
  target.dispatchEvent(event)
  return event
}

describe('createNativeTabMiddleClick', () => {  it('closes the pressed tab through its own published action', () => {
    const controller = createNativeTabMiddleClick()
    const close = vi.fn()
    controller.register('tab-1', close)
    const { tab, chip } = mountChip({ tabId: 'tab-1' })

    // A press on the tab's own padding still resolves to the tab (the chip is
    // inside the kit's box) and the release settles over the chip.
    mouse(tab, 'mousedown', 1)
    mouse(chip, 'mouseup', 1)
    expect(close).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('disarms autoscroll and keeps the kit\u2019s drag tracking out of the press', () => {
    const controller = createNativeTabMiddleClick()
    controller.register('tab-1', () => {})
    const { tab, chip } = mountChip({ tabId: 'tab-1' })

    expect(mouse(chip, 'mousedown', 1).defaultPrevented).toBe(true)
    mouse(chip, 'mouseup', 1)
    // A left press is the kit's own gesture and stays untouched.
    expect(mouse(tab, 'mousedown', 0).defaultPrevented).toBe(false)
    controller.dispose()
  })

  it('never touches a host tab (no plugin chip published for it)', () => {
    const controller = createNativeTabMiddleClick()
    const { tab, chip } = mountChip({ tabId: 'ui-sidebar-guide', plugin: false })

    const down = mouse(chip, 'mousedown', 1)
    expect(down.defaultPrevented).toBe(false)
    expect(down.cancelBubble).toBe(false)
    mouse(chip, 'mouseup', 1)
    void tab
    controller.dispose()
  })

  it('does not close when the release leaves the pressed tab', () => {
    const controller = createNativeTabMiddleClick()
    const close = vi.fn()
    controller.register('tab-1', close)
    const { tab } = mountChip({ tabId: 'tab-1' })
    const other = document.createElement('div')
    document.body.append(other)

    mouse(tab, 'mousedown', 1)
    mouse(other, 'mouseup', 1)
    expect(close).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('cancels a press that drifts past the slop (a middle drag)', () => {
    const controller = createNativeTabMiddleClick()
    const close = vi.fn()
    controller.register('tab-1', close)
    const { tab, chip } = mountChip({ tabId: 'tab-1' })

    mouse(tab, 'mousedown', 1, 10, 10)
    mouse(chip, 'mouseup', 1, 40, 10)
    expect(close).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('settles at most one close per press', () => {
    const controller = createNativeTabMiddleClick()
    const close = vi.fn()
    controller.register('tab-1', close)
    const { tab, chip } = mountChip({ tabId: 'tab-1' })

    mouse(tab, 'mousedown', 1)
    mouse(chip, 'mouseup', 1)
    mouse(chip, 'mouseup', 1)
    expect(close).toHaveBeenCalledTimes(1)
    controller.dispose()
  })

  it('skips a press whose tab was closed under it', () => {
    const controller = createNativeTabMiddleClick()
    const close = vi.fn()
    controller.register('tab-1', close)
    const { tab } = mountChip({ tabId: 'tab-1' })

    mouse(tab, 'mousedown', 1)
    tab.remove()
    mouse(document.body, 'mouseup', 1)
    expect(close).not.toHaveBeenCalled()
    controller.dispose()
  })

  it('unpublishes only the action it published, and stops on dispose', () => {
    const controller = createNativeTabMiddleClick()
    const first = vi.fn()
    const second = vi.fn()
    const release = controller.register('tab-1', first)
    // A re-render publishes a newer action under the same id; the old chip's
    // cleanup must not withdraw it.
    controller.register('tab-1', second)
    release()
    const { tab, chip } = mountChip({ tabId: 'tab-1' })
    mouse(tab, 'mousedown', 1)
    mouse(chip, 'mouseup', 1)
    expect(second).toHaveBeenCalledTimes(1)

    const third = vi.fn()
    controller.register('tab-2', third)
    controller.dispose()
    const { tab: tab2, chip: chip2 } = mountChip({ tabId: 'tab-2' })
    mouse(tab2, 'mousedown', 1)
    mouse(chip2, 'mouseup', 1)
    expect(third).not.toHaveBeenCalled()
  })

  it('stamps the tab id under the exported marker', () => {
    expect(nativeTabMarker('tab-9')).toEqual({ [NATIVE_TAB_MARKER]: 'tab-9' })
  })
})
