function flashMiddleware(req, res, next) {
  res.locals.flash = req.session.flash || {};
  delete req.session.flash;

  req.flash = function (type, message) {
    if (!req.session.flash) req.session.flash = {};
    req.session.flash[type] = message;
  };

  next();
}

module.exports = { flashMiddleware };
