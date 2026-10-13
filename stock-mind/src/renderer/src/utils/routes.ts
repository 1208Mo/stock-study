export function stockRoute(code: string, name?: string): string {
    return name ? `/stock/${code}?name=${encodeURIComponent(name)}` : `/stock/${code}`
}
