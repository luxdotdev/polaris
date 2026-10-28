/**
 * The posture as React state, from `modules/polaris-hinge`: its first answer, then each change,
 * each a JSON report parsed here. Off a Duo, off iOS 27.1, or in older builds, it stays folded.
 */
import { type NativeModule, requireOptionalNativeModule } from "expo";
import { useEffect, useState } from "react";
import { FOLDED, type Posture, postureOf, readReport } from "./posture.ts";

interface PostureEvent {
  readonly json: string;
}

declare class PolarisHingeModule extends NativeModule<{
  onPosture: (event: PostureEvent) => void;
}> {
  current(): Promise<string>;
}

const native = requireOptionalNativeModule<PolarisHingeModule>("PolarisHinge");

export const usePosture = (): Posture => {
  const [posture, setPosture] = useState<Posture>(FOLDED);

  useEffect(() => {
    if (native === null) return;
    let gone = false;

    const take = (json: string) => {
      if (__DEV__) console.log(`POLARIS_POSTURE ${json}`);

      if (!gone) setPosture(postureOf(readReport(json)));
    };

    const subscription = native.addListener("onPosture", (event) => take(event.json));

    void native.current().then(take, () => undefined);

    return () => {
      gone = true;
      subscription.remove();
    };
  }, []);

  return posture;
};
