/** Breadcrumb crumb shape used by AppLayout page headers. */
export type BreadcrumbItem = {
  label: string;
  to?: string;
  params?: Record<string, string>;
};
