import { inject, type InjectionKey } from 'vue'

import type {
  ApplicationContext,
  MailApplicationController,
} from './application'

export const applicationContextKey: InjectionKey<ApplicationContext> =
  Symbol('ApplicationContext')

export const mailApplicationControllerKey: InjectionKey<MailApplicationController> =
  Symbol('MailApplicationController')

export function useApplicationContext(): ApplicationContext {
  const context = inject(applicationContextKey)
  if (context === undefined) {
    throw new Error('ApplicationContext has not been provided')
  }
  return context
}

export function useMailApplicationController(): MailApplicationController {
  const controller = inject(mailApplicationControllerKey)
  if (controller === undefined) {
    throw new Error('MailApplicationController has not been provided')
  }
  return controller
}
