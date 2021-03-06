/*
 * hapi-fluxible
 * https://github.com/radek/hapi-fluxible
 *
 * Copyright (c) 2014 Radek
 * Licensed under the MIT license.
 *
 *
 */
'use strict';
var path = require('path');
var React = require('react');
var _merge = require('lodash.merge');
var serialize = require('serialize-javascript');
var navigateAction = require('flux-router-component').navigateAction;
var Promise = require('bluebird');
var debug = require('debug');

var DEFAULT_OPTIONS = {
  doctype: '<!DOCTYPE html>',
  appPath: './',
  fluxApp: 'app.js',
  rootComponent: 'components/Html'
};

exports.register = function(server, options, next) {
  options = _merge (DEFAULT_OPTIONS, options);

  var App; var RootComponent;
  var fluxAppPath = path.join(options.appPath, options.fluxApp);
  var rootComponentPath = path.join(options.appPath, options.rootComponent);

  try {
    App = require(fluxAppPath);
  } catch (e) {
    return function() {
      throw e;
    };
  }
  try {
    RootComponent = React.createFactory(require(rootComponentPath));
  } catch (e) {
    return function() {
      throw e;
    };
  }
  var Component = App.getComponent();

  var fetchrPlugin = App.getPlugin('FetchrPlugin');
  if (!fetchrPlugin) {
    throw new Error ('No fetchr plugin');
  }

  server.ext('onPostHandler', function(req, reply) {
    var context = App.createContext({
      req: req
    });

    var actionContext = context.getActionContext();

    // simple implementation of response (express like)
    var response = {
      statusCode: null,
      status: function(status) {
        this.statusCode = status;
        return this;
      },
      send: function(data) {
        if (this.statusCode) {
          reply(data).code(this.statusCode);
          return this;
        }
        reply(data);
        return this;
      },
      json: function(respObj) {
        return this.send(respObj);
      },
      end: function() {
        reply.continue();
        return this;
      }
    };

    // first will check if request should be handled by fetcher middleware
    var runFetchrHandlers = function() {
      return new Promise(function(resolve, reject) {
        var middleware = fetchrPlugin.getMiddleware();
        if (req.path.indexOf(fetchrPlugin.getXhrPath()) === 0) {
          req.method = req.method.toUpperCase(); // align with express naming
          middleware(req, response, next);
          resolve(true);
        }
        resolve();
      });
    };

    runFetchrHandlers().then(function(apiResponse) {

      if (apiResponse) {
        return;
      }

      actionContext.executeAction(navigateAction, {
          url: req.path
        }, function(err) {
          if (err) {
            if (err.status && err.status === 404) {
              return reply.continue();
            }
            next(err);
          }

          var exposed = 'window.App=' + serialize(App.dehydrate(context)) + ';';

          var html = React.renderToStaticMarkup(RootComponent({
            state: exposed,
            context: context.getComponentContext(),
            markup: React.renderToString(Component({
              context: context.getComponentContext()
            }))
          }));

          return reply(options.doctype + html);
        });
    }).catch(function(err) {

      debug('Fetchr err: ', err);

      next(err);
    });
  });
  next();
};

exports.register.attributes = {
  pkg: require('../package.json')
};
