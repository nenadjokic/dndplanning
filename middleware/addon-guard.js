/**
 * Middleware that returns 404 if the requested addon is disabled.
 * Usage: router.use(addonGuard('maps'))
 */
function addonGuard(addonId) {
  return (req, res, next) => {
    const addonManager = req.app.locals.addonManager;
    if (!addonManager || !addonManager.isEnabled(addonId)) {
      return res.status(404).render('404', { message: 'This feature is not currently enabled.' });
    }
    next();
  };
}

module.exports = addonGuard;
