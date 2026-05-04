# Lista de pendientes

Aplicacion web elegante para registrar tareas por texto, asignar prioridad por color, crear sublistas internas y decidir si las tareas completadas se archivan o se eliminan.

## Uso

1. Abre `index.html` en un navegador moderno.
2. Escribe una tarea.
3. Agrega detalles opcionales, como lista de mercado, pagos, referencias o pasos.
4. Elige prioridad: alta roja, media amarilla o baja verde.
5. Marca detalles internos o la tarea completa cuando esten terminados.

Las tareas se guardan automaticamente en el navegador.

## Uso compartido

Para que dos dispositivos usen la misma lista al mismo tiempo, inicia el servidor sincronizado:

```powershell
python sync_server.py
```

Abre `http://127.0.0.1:4174/` en este computador. En el celular o en otro equipo conectado a la misma red Wi-Fi, abre `http://IP-DE-ESTE-COMPUTADOR:4174/`.

La lista se guarda en `lista_compartida.json` y se actualiza automaticamente cada pocos segundos.

## Orden de la lista

La lista se agrupa por prioridad y mantiene el orden de llegada dentro de cada grupo:

1. Rojas
2. Amarillas
3. Verdes

## Compartir e instalar

Para compartir por WhatsApp y permitir instalacion en celular, publica esta carpeta en un hosting HTTPS, por ejemplo Netlify, Vercel, GitHub Pages o Google Drive con publicacion web. Despues copia el enlace publico desde el navegador y envialo por WhatsApp.

La instalacion como app aparece en Chrome/Edge/Android cuando se abre desde HTTPS o desde `localhost`.
