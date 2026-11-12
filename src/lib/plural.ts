/** "1 tarea" / "3 tareas": número y palabra en singular o plural según corresponda. */
export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
