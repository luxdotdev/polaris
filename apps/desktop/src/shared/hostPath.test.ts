import { describe, expect, test } from "bun:test";
import { joinPath, pathBaseName, pathWithin, tildePath } from "./hostPath.ts";

const WIN_HOME = "C:\\Users\\lucas";

describe("paths as a Windows Host spells them", () => {
  test("the home reads as ~, with the Host's separator", () => {
    expect(tildePath("C:\\Users\\lucas\\code\\polaris", WIN_HOME)).toBe("~\\code\\polaris");
    expect(tildePath(WIN_HOME, WIN_HOME)).toBe("~");
    // NTFS ignores case, and a sibling sharing the prefix isn't under the home.
    expect(tildePath("c:\\users\\LUCAS\\x", WIN_HOME)).toBe("~\\x");
    expect(tildePath("C:\\Users\\lucasd\\x", WIN_HOME)).toBe("C:\\Users\\lucasd\\x");
  });

  test("a relative git path joins with backslashes, and a drive root keeps its own", () => {
    expect(joinPath("C:\\code\\p", "src/a.ts")).toBe("C:\\code\\p\\src\\a.ts");
    expect(joinPath("C:\\", "code")).toBe("C:\\code");
    expect(pathWithin("C:\\code\\p\\src\\a.ts", "C:\\code\\p")).toBe("src\\a.ts");
  });

  test("the last segment ignores trailing separators of either kind", () => {
    expect(pathBaseName("C:\\code\\polaris\\")).toBe("polaris");
    expect(pathBaseName("C:/code/polaris")).toBe("polaris");
  });

  test("POSIX paths keep a backslash as part of a name", () => {
    expect(pathBaseName("/home/ada/odd\\name")).toBe("odd\\name");
    expect(tildePath("/home/ada/code", "/home/ada")).toBe("~/code");
    expect(joinPath("/", "srv")).toBe("/srv");
  });
});
