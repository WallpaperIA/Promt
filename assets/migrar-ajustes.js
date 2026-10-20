/* Los ajustes viajan entre dos ventanas del mismo navegador. No hay pedidos
   con personajes o textos a un servidor, ni se copian credenciales/cachés. */
(() => {
  const cuenta = 'https://promt-iota.vercel.app';
  const publico = 'https://wallpaperia.github.io';
  const claves = ['wp_chars_v1', 'wp_deleted_v2', 'wp_favs_v1', 'wp_edits_v1', 'wp_stats_v1',
    'wp_compact_v1', 'wp_sort_v1', 'wp_style_v1', 'wp_outfit_v1', 'wp_outfit_favs_v1',
    'wp_hair_v1', 'wp_format_v1', 'wp_details_v1', 'wp_accent_v1', 'wp_vip_theme_v1',
    'wp_lp_collapsed_v1', 'wp_edad_v1'];
  if (location.origin === publico && location.pathname === '/Promt/migrar-ajustes.html') {
    addEventListener('message', event => {
      if (event.origin !== cuenta || event.source !== opener || !opener || event.data?.tipo !== 'wp-pedir-ajustes') return;
      const datos = {};
      let bytes = 0;
      for (const clave of claves) {
        const valor = localStorage.getItem(clave);
        if (valor !== null && bytes + valor.length <= 400000) { datos[clave] = valor; bytes += valor.length; }
      }
      opener.postMessage({ tipo: 'wp-ajustes-locales', nonce: event.data.nonce, datos }, cuenta);
    });
    if (opener) opener.postMessage({ tipo: 'wp-ajustes-listos' }, cuenta);
    return;
  }
  if (location.origin !== cuenta || parent !== window) return;
  const grupo = document.querySelector('#settings-panel .settings-group:last-child');
  if (!grupo) return;
  // Una ventana de primer nivel conserva acceso al almacenamiento anterior
  // también cuando el navegador particiona el de los iframes de terceros.
  const boton = document.createElement('button');
  boton.type = 'button'; boton.className = 'hdr-btn';
  boton.textContent = 'Traer mis ajustes anteriores';
  boton.title = 'Recuperar personajes, favoritas y ajustes del enlace anterior de Wallpaperia';
  grupo.appendChild(boton);
  let ventana = null, nonce = null;
  boton.addEventListener('click', () => {
    nonce = crypto.randomUUID();
    ventana = window.open(publico + '/Promt/migrar-ajustes.html', 'wp-ajustes-locales', 'popup,width=480,height=360');
  });
  addEventListener('message', event => {
    if (!ventana || event.origin !== publico || event.source !== ventana) return;
    if (event.data?.tipo === 'wp-ajustes-listos') {
      ventana.postMessage({ tipo: 'wp-pedir-ajustes', nonce }, publico);
      return;
    }
    if (event.data?.tipo !== 'wp-ajustes-locales' || event.data.nonce !== nonce) return;
    const datos = event.data.datos;
    if (!datos || typeof datos !== 'object') return;
    let bytes = 0, cambios = 0;
    for (const clave of claves) {
      const valor = datos[clave];
      if (typeof valor !== 'string' || (bytes += valor.length) > 400000) continue;
      if (localStorage.getItem(clave) === null) { localStorage.setItem(clave, valor); cambios++; }
    }
    ventana.close(); ventana = null; nonce = null;
    if (cambios) location.reload();
    else boton.textContent = 'Ajustes recuperados';
  });
})();
