import { useEffect } from 'react';

type BackHandler = () => void;

// Global stack of back handlers
const backStack: { id: string; handler: BackHandler }[] = [];

let isInitialized = false;

function initGlobalBackListener() {
  if (isInitialized || typeof window === 'undefined') return;
  isInitialized = true;

  window.addEventListener('popstate', () => {
    if (backStack.length > 0) {
      const top = backStack.pop();
      if (top && top.handler) {
        top.handler();
      }
    }
  });
}

/**
 * Register a back handler.
 * Whenever `isActive` becomes true, pushes a browser history entry and registers the handler.
 * When popped via back button or swipe, executes `onBack()`.
 * If closed programmatically (e.g. by clicking 'X'), automatically cleans up and rolls back history.
 */
export function useBackHandler(
  id: string,
  isActive: boolean,
  onBack: () => void
) {
  useEffect(() => {
    initGlobalBackListener();

    if (!isActive) return;

    // Push dummy history entry
    window.history.pushState({ backStackId: id }, '');

    let wasHandledByPop = false;

    const wrappedHandler = () => {
      wasHandledByPop = true;
      onBack();
    };

    backStack.push({ id, handler: wrappedHandler });

    return () => {
      // Clean up from stack if it wasn't triggered by popstate
      const idx = backStack.findIndex((item) => item.id === id);
      if (idx !== -1) {
        backStack.splice(idx, 1);
      }
      // If closed manually (like clicking 'X'), remove the history entry we pushed
      if (!wasHandledByPop) {
        // Only if our state is the current one
        if (window.history.state && window.history.state.backStackId === id) {
          window.history.back();
        }
      }
    };
  }, [isActive, id]);
}
