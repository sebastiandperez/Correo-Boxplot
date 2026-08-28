import type {
  NativeAttachmentDto,
  NativeBodyDto,
  NativeMailIpcPort,
  NativeMailOpenRequest,
  NativeMailOpenResponse,
  NativeMailboxDto,
  NativeMailboxSnapshotDto,
  NativeMessageRequest,
  NativeMoveRequest,
  NativeMoveResponse,
  NativeSmtpSubmitRequest,
  NativeSmtpSubmitResponse,
  NativeStoreFlagsRequest,
} from './ipc'

export type NativeMailInvoke = <T>(
  command: string,
  args: Readonly<{ request: object }>,
) => Promise<T>

const commands = {
  open: 'native_mail_open',
  close: 'native_mail_close',
  listMailboxes: 'native_imap_list_mailboxes',
  snapshotMailbox: 'native_imap_snapshot_mailbox',
  fetchBody: 'native_imap_fetch_body',
  fetchAttachments: 'native_imap_fetch_attachments',
  storeFlags: 'native_imap_store_flags',
  move: 'native_imap_move',
  smtpSubmit: 'native_smtp_submit',
} as const

export const NATIVE_MAIL_COMMANDS = Object.freeze(Object.values(commands))

export class NativeMailIpcClient implements NativeMailIpcPort {
  constructor(private readonly invoke: NativeMailInvoke) {}

  open(request: NativeMailOpenRequest): Promise<NativeMailOpenResponse> {
    return this.call(commands.open, request)
  }
  close(sessionId: string): Promise<void> {
    return this.call(commands.close, { sessionId })
  }
  listMailboxes(sessionId: string): Promise<readonly NativeMailboxDto[]> {
    return this.call(commands.listMailboxes, { sessionId })
  }
  snapshotMailbox(
    sessionId: string,
    mailbox: string,
  ): Promise<NativeMailboxSnapshotDto> {
    return this.call(commands.snapshotMailbox, { sessionId, mailbox })
  }
  fetchBody(request: NativeMessageRequest): Promise<NativeBodyDto> {
    return this.call(commands.fetchBody, request)
  }
  fetchAttachments(
    request: NativeMessageRequest,
  ): Promise<readonly NativeAttachmentDto[]> {
    return this.call(commands.fetchAttachments, request)
  }
  storeFlags(request: NativeStoreFlagsRequest): Promise<void> {
    return this.call(commands.storeFlags, request)
  }
  move(request: NativeMoveRequest): Promise<NativeMoveResponse> {
    return this.call(commands.move, request)
  }
  smtpSubmit(
    request: NativeSmtpSubmitRequest,
  ): Promise<NativeSmtpSubmitResponse> {
    return this.call(commands.smtpSubmit, request)
  }

  private call<T>(command: string, request: object): Promise<T> {
    return this.invoke<T>(command, { request })
  }
}
