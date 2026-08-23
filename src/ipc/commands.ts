export const IPC_READ_COMMANDS = [
  'local_read_account',
  'local_list_accounts',
  'local_read_mailbox',
  'local_list_mailboxes',
  'local_read_identity',
  'local_list_identities',
  'local_read_email',
  'local_read_emails',
  'local_read_email_memberships',
  'local_read_email_body',
  'local_read_attachment_refs',
  'local_read_mailbox_view',
  'local_read_collection_sync_cursor',
  'local_read_pending_mutation',
  'local_list_pending_mutations',
] as const

export const IPC_WRITE_COMMANDS = [
  'local_register_account',
  'local_apply_collection_sync',
  'local_cache_email_body',
  'local_replace_attachment_refs',
  'local_replace_mailbox_view',
  'local_stage_send_mutation',
  'local_apply_optimistic_keyword_mutation',
  'local_apply_optimistic_mailbox_membership_mutation',
  'local_replace_pending_mutation_if_current',
  'local_remove_confirmed_mutation',
] as const

export const LOCAL_STATE_CHANGED_EVENT = 'local-state-changed' as const
