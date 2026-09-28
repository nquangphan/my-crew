import { createContext, useContext } from 'react';

export interface ShellActions {
  openCreate: () => void;
  openSearch: () => void;
  openShortcuts: () => void;
}

export const ShellContext = createContext<ShellActions>({
  openCreate: () => {},
  openSearch: () => {},
  openShortcuts: () => {},
});

export const useShell = () => useContext(ShellContext);

/** Key of the project the sidebar shows; remembered so non-project pages keep it. */
export const CURRENT_PROJECT_KEY = 'crew.currentProject';
