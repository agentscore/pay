#
# DO NOT INSTALL DIRECTLY — this file is a TEMPLATE.
# The `sha256` field is a placeholder and `brew install` will fail.
#
# Homebrew formula template for @agent-score/pay.
#
# To publish:
#   1. Create a `agentscore/homebrew-tap` repo if not already present.
#   2. Copy this file to `agentscore/homebrew-tap/Formula/agentscore-pay.rb`.
#   3. Update `url` + `sha256` after every npm publish:
#        URL=https://registry.npmjs.org/@agent-score/pay/-/pay-${VERSION}.tgz
#        curl -fsSL "$URL" | shasum -a 256
#   4. Users install with:
#        brew tap agentscore/tap
#        brew install agentscore-pay
#
class AgentscorePay < Formula
  desc "CLI wallet for one-shell-command agent payments (x402 + MPP)"
  homepage "https://agentscore.sh"
  url "https://registry.npmjs.org/@agent-score/pay/-/pay-0.1.0.tgz"
  sha256 "REPLACE_WITH_TARBALL_SHA256"
  license "MIT"

  depends_on "node"

  def install
    system "npm", "install", *Language::Node.std_npm_install_args(libexec)
    bin.install_symlink Dir["#{libexec}/bin/*"]
  end

  test do
    assert_match(/agentscore-pay/, shell_output("#{bin}/agentscore-pay --version"))
  end
end
