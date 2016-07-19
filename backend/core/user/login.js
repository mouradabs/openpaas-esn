'use strict';

var async = require('async');
var urljoin = require('url-join');
var mongoose = require('mongoose');

var config = require('../esn-config')('login');
var pubsub = require('../pubsub').local;
var jwt = require('../auth').jwt;
var email = require('../email');
var i18n =  require('../../i18n');
var helpers = require('../../helpers');

var User = mongoose.model('User');
var PasswordReset = mongoose.model('PasswordReset');

var DEFAULT_LOGIN_FAILURE = 5;

module.exports.success = function(email, callback) {
  User.loadFromEmail(email, function(err, user) {
    if (err) {
      return callback(err);
    }
    if (!user) {
      return callback(new Error('No such user ' + email));
    }
    pubsub.topic('login:success').publish(user);
    user.loginSuccess(callback);
  });
};

module.exports.failure = function(email, callback) {
  User.loadFromEmail(email, function(err, user) {
    if (err) {
      return callback(err);
    }
    if (!user) {
      return callback(new Error('No such user ' + email));
    }
    pubsub.topic('login:failure').publish(user);
    user.loginFailure(callback);
  });
};

module.exports.canLogin = function(email, callback) {
  var size = DEFAULT_LOGIN_FAILURE;
  config.get(function(err, data) {
    if (data && data.failure && data.failure.size) {
      size = data.failure.size;
    }

    User.loadFromEmail(email, function(err, user) {
      if (err) {
        return callback(err);
      }
      if (!user) {
        return callback(new Error('No such user ' + email));
      }
      if (user.login.failures && user.login.failures.length >= size) {
        return callback(null, false);
      }
      return callback(err, true);
    });
  });
};

module.exports.sendPasswordReset = function(user, callback) {
  var to = user.preferredEmail;

  function getConfiguration(callback) {
    async.parallel([
      helpers.config.getNoReply,
      helpers.config.getBaseUrl
    ], callback);
  }

  function generateJWTurl(baseUrl, callback) {
    var payload = {email: to, action: 'PasswordReset'};
    jwt.generateWebToken(payload, function(err, token) {
      callback(err, urljoin(baseUrl, '/passwordreset/?jwt=' + token));
    });
  }

  function createNewPasswordReset(url, callback) {
    new PasswordReset({ email: to, url: url }).save(function(err, saved) {
      callback(err, { email: to, url: url });
    });
  }

  function sendEmail(noreply, passwordreset, callback) {
    var subject = i18n.__('You have requested a password reset on OpenPaas');
    var context = {
      firstname: user.firstname,
      lastname: user.lastname,
      url: passwordreset.url
    };
    email.sendHTML(noreply, to, subject, 'core.password-reset', context, callback);
  }

  getConfiguration(function(err, results) {
    if (err) {
      return callback(err);
    }

    async.waterfall([
      generateJWTurl.bind(null, results[1]),
      createNewPasswordReset,
      sendEmail.bind(null, results[0])
    ], callback);
  });
};
