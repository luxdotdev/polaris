// A Polaris account's sign-in (apps/mobile/src/accounts/authorizer.ts): the Account Server's
// page in ASWebAuthenticationSession, which hands back the polaris:// redirect it ends on.
import AuthenticationServices
import ExpoModulesCore
import UIKit

public class PolarisAuthSessionModule: Module {
  private var session: ASWebAuthenticationSession?
  private let anchor = KeyWindowAnchor()

  public func definition() -> ModuleDefinition {
    Name("PolarisAuthSession")

    /// The URL the browser was sent back to, or nil when the user cancelled.
    AsyncFunction("start") { (url: URL, callbackScheme: String, promise: Promise) in
      self.session?.cancel()
      let session = ASWebAuthenticationSession(url: url, callbackURLScheme: callbackScheme) {
        returned, error in
        self.session = nil
        if let returned {
          promise.resolve(returned.absoluteString)
        } else if let error = error as? ASWebAuthenticationSessionError,
          error.code == .canceledLogin
        {
          promise.resolve(nil)
        } else {
          promise.reject("ERR_AUTH_SESSION", error?.localizedDescription ?? "sign-in failed")
        }
      }
      session.presentationContextProvider = self.anchor
      session.prefersEphemeralWebBrowserSession = false
      self.session = session
      if !session.start() {
        self.session = nil
        promise.reject("ERR_AUTH_SESSION", "the sign-in couldn't start")
      }
    }.runOnQueue(.main)
  }
}

/// The app's key window, where the sign-in sheet presents.
final class KeyWindowAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
  func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
    let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
    return scenes.flatMap(\.windows).first(where: \.isKeyWindow) ?? ASPresentationAnchor()
  }
}
