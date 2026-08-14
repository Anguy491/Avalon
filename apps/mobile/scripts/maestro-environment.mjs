import { existsSync } from 'node:fs';

const homebrewJavaHome =
  '/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home';

export function maestroEnvironment(environment = process.env) {
  if (environment.JAVA_HOME !== undefined) return environment;
  return existsSync(homebrewJavaHome)
    ? { ...environment, JAVA_HOME: homebrewJavaHome }
    : environment;
}
