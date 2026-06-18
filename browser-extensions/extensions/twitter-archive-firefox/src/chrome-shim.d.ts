declare namespace chrome {
  interface RuntimeError {
    readonly message: string
  }

  namespace runtime {
    const lastError: RuntimeError | undefined

    interface InstalledDetails {
      readonly reason?: string
    }

    interface MessageSender {
      readonly tab?: tabs.Tab
      readonly frameId?: number
      readonly url?: string
    }

    interface OnInstalledEvent {
      addListener(callback: (details: InstalledDetails) => void): void
    }

    interface OnStartupEvent {
      addListener(callback: () => void): void
    }

    interface OnMessageEvent {
      addListener(
        callback: (
          message: unknown,
          sender: MessageSender,
          sendResponse: (response: unknown) => void,
        ) => boolean | void,
      ): void
    }

    const onInstalled: OnInstalledEvent
    const onStartup: OnStartupEvent
    const onMessage: OnMessageEvent
  }

  namespace storage {
    namespace local {
      function set(items: Record<string, unknown>, callback?: () => void): void
    }
  }

  namespace tabs {
    interface Tab {
      readonly id?: number
      readonly url?: string
      readonly title?: string
      readonly active?: boolean
    }

    function query(queryInfo: { active?: boolean; currentWindow?: boolean }, callback: (tabs: Tab[]) => void): void
    function sendMessage(tabId: number, message: unknown, callback: (response: unknown) => void): void
  }

  namespace contextMenus {
    type ContextType = "browser_action"

    interface CreateProperties {
      readonly id: string
      readonly title: string
      readonly contexts: readonly ContextType[]
    }

    interface OnClickData {
      readonly menuItemId?: string | number
    }

    interface OnClickedEvent {
      addListener(callback: (info: OnClickData, tab?: tabs.Tab) => void): void
    }

    function removeAll(callback?: () => void): void
    function create(createProperties: CreateProperties): void
    const onClicked: OnClickedEvent
  }

  namespace browserAction {
    function setBadgeBackgroundColor(details: { color: string }): void
    function setBadgeText(details: { text: string }): void
    function setTitle(details: { title: string }): void

    interface OnClickedEvent {
      addListener(callback: (tab?: tabs.Tab) => void): void
    }

    const onClicked: OnClickedEvent
  }

  namespace commands {
    interface OnCommandEvent {
      addListener(callback: (command: string) => void): void
    }

    const onCommand: OnCommandEvent
  }
}

declare const chrome: typeof chrome
