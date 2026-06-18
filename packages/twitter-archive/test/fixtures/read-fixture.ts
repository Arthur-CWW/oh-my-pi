export const readFixture = (name: string) => Bun.file(new URL(name, import.meta.url)).text()
