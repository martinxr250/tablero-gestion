# Tableros · recursos visuales e integración

El nombre vigente es **Tableros** y el símbolo activo conserva las tres columnas Kanban. Se mantiene la paleta violeta/lavanda y Plus Jakarta Sans. La propuesta de nombre alternativa quedó archivada y no se usa en la aplicación.

## Entregables

| Familia | Cantidad | Ubicación / uso |
| --- | --- | --- |
| Renders 3D originales | 11 composiciones | `public/assets/3d/`; PNG originales generados con imagegen, entregas WebP con alpha |
| Portadas | 16 SVG | `covers/`; 8 diseños en claro y oscuro, preparados como recursos opcionales |
| Símbolos de proyecto | 8 SVG | `project-icons/`; se asignan de forma estable a cada tablero, conservando su color |
| Patrones geométricos | 5 SVG | `patterns/`; detalles tenues en las tarjetas y fondos |
| Ilustraciones vectoriales | 8 SVG | `illustrations/`; familia original con volumen geométrico |
| Marca | Claro, oscuro, monocromo, favicon e íconos PNG | `brand/`; nombre Tableros y símbolo de tres columnas |
| Catálogo | HTML local con selector de tema sin JavaScript | `public/assets/catalog.html`, disponible en `/assets/catalog.html` |

Los 8 renders ampliados representan proyectos, colaboración, integraciones, asistente, actividad, notificaciones, búsqueda y seguridad. Se suman las tarjetas flotantes iniciales y las dos composiciones de acceso/registro. Los dos renders de autenticación conservan 1254 × 1254 px y calidad WebP 96 para evitar la pérdida de detalle al mostrarlos en pantallas densas; se sirven mediante next/image sin otra conversión con pérdida. Las variantes antiguas reducidas se mantienen como entregables de la primera etapa.

## Integración

- Dashboard: detalle 3D en encabezado y estados de proyectos, tareas y actividad vacíos.
- Tableros: símbolos personalizados y patrones discretos, sin fondos detrás de columnas Kanban.
- Búsqueda y notificaciones: renders específicos para resultados vacíos, y detalle en el popover de notificaciones.
- Mi cuenta: símbolo de seguridad en encabezado y requisitos de contraseña consistentes.
- Integraciones: render en la conexión con GitHub; se conservan los endpoints y el flujo existente.
- Acceso: tarjeta de cristal lavanda, presentación e ilustración a la izquierda, formulario centrado verticalmente. Se retiró únicamente el subtítulo bajo el nombre, manteniendo titular y descripción. Modo oscuro equivalente, y composición móvil de una columna.
- Registro: render propio de una pieza con el logo y una segunda pieza con el símbolo de suma. Campos compactos, confirmación de contraseña e indicadores de requisitos. Sin scroll dentro de la tarjeta; en ventanas extremadamente bajas el documento puede crecer para mantener los controles accesibles.
- El recurso del asistente queda disponible en la biblioteca; no se agrega una función de IA ni una ruta ficticia.

Los estilos de autenticación están en `src/app/(auth)/auth.css`; los tokens y tratamientos compartidos siguen en `globals.css`. Los movimientos sutiles se desactivan con `prefers-reduced-motion`. No se incorporaron dependencias nuevas.

## Contraseñas

Por pedido del usuario, se agregó repetición y una política mínima de 8 caracteres con mayúscula, minúscula y número, manteniendo el límite de 128 y los controles existentes contra claves comunes, repetitivas o que incluyen el correo. El cliente y el servidor comparten las reglas en `src/lib/password-policy.ts`. La confirmación se comprueba localmente y no se envía como un campo nuevo al endpoint. Los indicadores distinguen pendientes, faltantes y cumplidos. El botón de registro se habilita al completar los requisitos y la coincidencia.

## Validación

- Lint y TypeScript correctos.
- Build de producción correcto mediante `next build --webpack`. Turbopack no pudo completar su build por una restricción del entorno al iniciar un proceso/puerto local.
- 26 pruebas unitarias correctas, incluidas las nuevas verificaciones de política y concordancia entre cliente y servidor. Se ejecutaron sin el global setup de integración que recrea la base de prueba.
- Se comprobó en navegador que una clave incompleta mantiene el botón deshabilitado y que una clave válida con confirmación coincidente lo habilita. No se creó ninguna cuenta de prueba.
- Registro verificado sin desbordes ni scroll interno en escritorio y móvil de 390 × 844. Acceso revisado en ambos temas y tamaños.
- Las capturas `register-final-*` corresponden al resultado vigente. Otras capturas documentan iteraciones anteriores.
- Los SVG de la biblioteca se verificaron como XML válido.
- No se hizo un recorrido autenticado completo por las vistas privadas. Sus componentes se revisaron en una composición temporal de la primera etapa, luego retirada.

Los cambios concurrentes de backend e integraciones se conservaron. Los prompts del generador están en `generation-prompt.md`, `expanded-prompts.md`, `login-prompt.md` y `register-prompt.md`.
