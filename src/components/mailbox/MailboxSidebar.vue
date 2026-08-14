<template>
  <aside class="mailbox-sidebar" aria-label="Carpetas de correo">
    <div class="mailbox-sidebar__brand">— correo</div>

    <button class="mailbox-sidebar__compose" type="button" disabled>
      <span aria-hidden="true">+</span>
      Redactar
    </button>

    <nav class="mailbox-sidebar__folders" aria-label="Carpetas">
      <button
        class="mailbox-sidebar__folder mailbox-sidebar__folder--current"
        type="button"
        aria-current="page"
        disabled
      >
        Bandeja de entrada
      </button>
      <button class="mailbox-sidebar__folder" type="button" disabled>
        Borradores
      </button>
      <button class="mailbox-sidebar__folder" type="button" disabled>
        Enviados
      </button>
      <button class="mailbox-sidebar__folder" type="button" disabled>
        Spam
      </button>
      <button class="mailbox-sidebar__folder" type="button" disabled>
        Papelera
      </button>
    </nav>

    <p class="mailbox-sidebar__account">Sin cuenta</p>
  </aside>
</template>
