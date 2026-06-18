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

    interface RuntimeMessage {
      readonly type?: string
      readonly signalIds?: readonly string[]
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
          message: RuntimeMessage | null,
          sender: MessageSender,
          sendResponse: (response: object) => void,
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
    interface QueryInfo {
      readonly active?: boolean
      readonly currentWindow?: boolean
      readonly url?: string | readonly string[]
    }

    interface ChangeInfo {
      readonly status?: "loading" | "complete"
      readonly url?: string
    }

    interface Tab {
      readonly id?: number
      readonly url?: string
      readonly title?: string
      readonly active?: boolean
    }

    function query(queryInfo: QueryInfo, callback: (tabs: Tab[]) => void): void
    function sendMessage(tabId: number, message: runtime.RuntimeMessage, callback: (response: object) => void): void
    const onUpdated: {
      addListener(callback: (tabId: number, changeInfo: ChangeInfo, tab: Tab) => void): void
    }
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
