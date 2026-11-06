-- Borrar un archivo del tablero (o el tablero entero) agenda el borrado de su objeto en el
-- almacenamiento, igual que los adjuntos de tarjeta.
create trigger board_files_gc after delete on app.board_files
  for each row execute function app.attachments_gc();
