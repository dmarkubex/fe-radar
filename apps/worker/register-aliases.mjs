import { register } from "node:module";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const hookUrl = new URL(import.meta.url);
const isRegisteredHook = hookUrl.searchParams.get("hook") === "1";

if (!isRegisteredHook) {
  const registeredHookUrl = new URL(import.meta.url);
  registeredHookUrl.searchParams.set("hook", "1");
  register(registeredHookUrl, import.meta.url);
}

const workerRootUrl = new URL("./", import.meta.url);
workerRootUrl.search = "";
workerRootUrl.hash = "";

const workspaceRootUrl = new URL("../../", workerRootUrl);
const distRootUrl = new URL("./dist/", workerRootUrl).href;
const pnpmVirtualStoreParentUrl = new URL(
  "./node_modules/.pnpm/node_modules/_resolve.mjs",
  workspaceRootUrl,
).href;

const packagePattern = /^@fe-radar\/(core|db|llm|shared)(\/.*)?$/;
const relativePattern = /^\.{1,2}\//;
const fileExtensionPattern = /\/?[^/]+\.[^/]+$/;
const barePackagePattern = /^(?:@[^/]+\/[^/]+|[^@./][^/]*)(?:\/.*)?$/;

function compiledArtifactUrl(packageName, subpath) {
  const artifactPath = subpath ? subpath.slice(1) : "index";
  const jsArtifactPath = artifactPath.endsWith(".js") ? artifactPath : `${artifactPath}.js`;

  return new URL(`./dist/packages/${packageName}/src/${jsArtifactPath}`, workerRootUrl).href;
}

async function fileExists(url) {
  try {
    await access(fileURLToPath(url));
    return true;
  } catch {
    return false;
  }
}

async function resolveRelativeArtifact(specifier, parentUrl) {
  if (!parentUrl?.startsWith(distRootUrl)) {
    return null;
  }

  if (!relativePattern.test(specifier) || fileExtensionPattern.test(specifier)) {
    return null;
  }

  const jsArtifactUrl = new URL(`${specifier}.js`, parentUrl);

  if (await fileExists(jsArtifactUrl)) {
    return jsArtifactUrl.href;
  }

  const indexArtifactUrl = new URL(`${specifier}/index.js`, parentUrl);

  if (await fileExists(indexArtifactUrl)) {
    return indexArtifactUrl.href;
  }

  return null;
}

function isBarePackageSpecifier(specifier) {
  return (
    !specifier.startsWith("node:") &&
    !specifier.startsWith("file:") &&
    !specifier.startsWith("data:") &&
    barePackagePattern.test(specifier)
  );
}

function appendJsExtensionToPackageSubpath(specifier) {
  const packageNameParts = specifier.startsWith("@") ? 2 : 1;
  const specifierParts = specifier.split("/");
  const subpathParts = specifierParts.slice(packageNameParts);

  if (subpathParts.length === 0 || fileExtensionPattern.test(specifier)) {
    return null;
  }

  return `${specifier}.js`;
}

async function tryResolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (error) {
    if (error?.code !== "ERR_MODULE_NOT_FOUND" && error?.code !== "MODULE_NOT_FOUND") {
      throw error;
    }

    return null;
  }
}

async function resolveBareDependency(specifier, context, nextResolve) {
  if (!context.parentURL?.startsWith(distRootUrl) || !isBarePackageSpecifier(specifier)) {
    return null;
  }

  const defaultResolution = await tryResolve(specifier, context, nextResolve);

  if (defaultResolution) {
    return defaultResolution;
  }

  const virtualStoreContext = {
    ...context,
    parentURL: pnpmVirtualStoreParentUrl,
  };
  const virtualStoreResolution = await tryResolve(specifier, virtualStoreContext, nextResolve);

  if (virtualStoreResolution) {
    return virtualStoreResolution;
  }

  const jsSubpathSpecifier = appendJsExtensionToPackageSubpath(specifier);

  if (!jsSubpathSpecifier) {
    return null;
  }

  return tryResolve(jsSubpathSpecifier, virtualStoreContext, nextResolve);
}

export async function resolve(specifier, context, nextResolve) {
  const match = packagePattern.exec(specifier);

  if (match) {
    return {
      url: compiledArtifactUrl(match[1], match[2]),
      shortCircuit: true,
    };
  }

  const bareDependencyResolution = await resolveBareDependency(specifier, context, nextResolve);

  if (bareDependencyResolution) {
    return bareDependencyResolution;
  }

  const relativeArtifactUrl = await resolveRelativeArtifact(specifier, context.parentURL);

  if (relativeArtifactUrl) {
    return {
      url: relativeArtifactUrl,
      shortCircuit: true,
    };
  }

  return nextResolve(specifier, context);
}
