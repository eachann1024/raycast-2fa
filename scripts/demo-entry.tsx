import { Detail, LocalStorage, environment, getPreferenceValues } from "@raycast/api";
import { useEffect, useState, type ComponentProps } from "react";
// These imports resolve after prepare-screenshot-demo.mjs copies this entry into src/.
import Codes from "./codes";
import { initializeDemo } from "./demo-data";

export default function ScreenshotDemo(props: ComponentProps<typeof Codes>) {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string>();
  useEffect(() => {
    let active = true;
    void initializeDemo({
      getItem: (key) => LocalStorage.getItem<string>(key),
      setItem: (key, value) => LocalStorage.setItem(key, value),
      removeItem: (key) => LocalStorage.removeItem(key),
    }, environment.extensionName, getPreferenceValues<Preferences>().dataFile).then(
      () => { if (active) setReady(true); },
      (cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : "Could not load fictional accounts."); },
    );
    return () => { active = false; };
  }, []);
  if (!ready) return <Detail isLoading={!error} markdown={error ?? ""} />;
  return <Codes {...props} />;
}
