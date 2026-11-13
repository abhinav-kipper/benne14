'use client';
// The menu a screen shows: the dishes in code plus the owner's changes from the dashboard
// (prices, names, sold out). One screen owns it (useMenu) and hands it to its parts through
// context (useCatalog), so nothing reads a hidden global and every render sees one consistent menu.
import { createContext, useCallback, useContext, useState } from 'react';
import { api } from '@/lib/client';
import { BASE_CATALOG, mergeCatalog, type Catalog } from '@/lib/menu';

const CatalogContext = createContext<Catalog>(BASE_CATALOG);
export const CatalogProvider = CatalogContext.Provider;
export const useCatalog = () => useContext(CatalogContext);

// Starts from the menu in code and replaces it each time `reload` succeeds. If the request fails
// the screen keeps the last menu it had, so a network blip never empties the kiosk.
export function useMenu() {
  const [catalog, setCatalog] = useState<Catalog>(BASE_CATALOG);
  const reload = useCallback(
    () =>
      api
        .menu()
        .then((o) => setCatalog(mergeCatalog(o)))
        .catch(() => {}),
    [],
  );
  return { catalog, reload };
}
