var _ = require('lodash');
var args = require('yargs').argv;
var babel = require('gulp-babel');
var babelify = require('babelify');
var browserify = require('browserify');
var browser_sync = require('browser-sync');
var buffer = require('vinyl-buffer');
var gulp = require('gulp');
var gulpif = require('gulp-if');
var jshint = require('gulp-jshint');
var lazypipe = require('lazypipe');
var log = require('fancy-log');
var useref = require('gulp-useref');
var uglify = require('gulp-uglify');
// var node_inspector = require('gulp-node-inspector');
var nodemon = require('gulp-nodemon');
var source = require('vinyl-source-stream');
var sourcemaps = require('gulp-sourcemaps');
var watchify = require('watchify');

//////////////////////////////////////////////////////////////////////////
// Server tasks
var config = {
  js_files: ['src/**/*.js', '!src/client/**/*.js'],
  all_js_files: ['src/**/*.js', '!src/client/vendor/**/*.js'],
  client_html: ['src/client/**/*.html'],
  client_css: ['src/client/**/*.css', '!src/client/sounds/Bfxr/**'],
  client_static: ['src/client/**/*.mp3', 'src/client/**/*.wav', 'src/client/**/*.ogg', 'src/client/**/*.png', '!src/client/sounds/Bfxr/**'], // 'src/client/**/vendor/**',
  client_vendor: ['src/client/**/vendor/**'],
};

var uglify_options = { keep_fnames : true };
//var uglify_options = { compress : false }; // do no minification

// gulp.task('inspect', function () {
//   gulp.src([]).pipe(node_inspector({
//     debugPort: 5858,
//     webHost: '0.0.0.0',
//     webPort: '8080',
//     preload: false
//   }));
// });

gulp.task('js', function () {
  return gulp.src(config.js_files)
    .pipe(sourcemaps.init())
    .pipe(babel())
    .pipe(sourcemaps.write('.'))
    .pipe(gulp.dest('./build'));
});

gulp.task('jshint', function () {
  return gulp.src(config.all_js_files)
    .pipe(jshint())
    .pipe(jshint.reporter('default'));
});

//////////////////////////////////////////////////////////////////////////
// client tasks
gulp.task('client_html', function () {
  return gulp.src(config.client_html)
    .pipe(jshint.extract('auto'))
    .pipe(jshint())
    .pipe(jshint.reporter('default'))
    .pipe(useref({}, lazypipe().pipe(sourcemaps.init, { loadMaps: true })))
    .pipe(gulpif('*.js', uglify(uglify_options)))
    .on('error', log.error.bind(log, 'client_html Error'))
    .pipe(sourcemaps.write('./')) // writes .map file
    .pipe(gulp.dest('./build/client'))
  ;
});

gulp.task('client_css', function () {
  return gulp.src(config.client_css)
    .pipe(gulp.dest('./build/client'))
    .pipe(browser_sync.reload({ stream: true }));
});

gulp.task('client_static', function () {
  return gulp.src(config.client_static)
    .pipe(gulp.dest('./build/client'));
});

(function () {
  var customOpts = {
    entries: ['./src/client/wrapper.js'],
    debug: true
  };
  var babelify_opts = { global: true }; // Required because dot-prop has ES6 code in it
  var opts = _.assign({}, watchify.args, customOpts);
  function dobundle(b) {
    return b.bundle()
      // log errors if they happen
      .on('error', log.error.bind(log, 'Browserify Error'))
      .pipe(source('wrapper.bundle.js'))
      // optional, remove if you don't need to buffer file contents
      .pipe(buffer())
      // optional, remove if you dont want sourcemaps
      .pipe(sourcemaps.init({loadMaps: true})) // loads map from browserify file
      // Add transformation tasks to the pipeline here.
      .pipe(uglify(uglify_options))
      .pipe(sourcemaps.write('./')) // writes .map file
      .pipe(gulp.dest('./build/client/'));
  }

  var watched = watchify(browserify(opts));
  watched.transform(babelify, babelify_opts);

  watched.on('update', function () {
    console.log('Task:client_js_watch::update');
    // on any dep update, runs the bundler
    dobundle(watched)
      .pipe(browser_sync.stream({ once: true }));
  });
  watched.on('log', log); // output build logs to terminal
  gulp.task('client_js_watch', function () {
    return dobundle(watched);
  });

  var nonwatched = browserify(opts);
  nonwatched.transform(babelify, babelify_opts);
  nonwatched.on('log', log); // output build logs to terminal
  gulp.task('client_js', function () {
    return dobundle(nonwatched);
  });
}());

//////////////////////////////////////////////////////////////////////////
// Combined tasks

gulp.task('build', ['jshint', 'js', 'client_html', 'client_css', 'client_static', 'client_js']);

gulp.task('bs-reload', ['client_static', 'client_html'], function () {
  browser_sync.reload();
});

gulp.task('watch', ['jshint', 'js', 'client_html', 'client_css', 'client_static', 'client_js_watch'], function() {
  gulp.watch(config.js_files, ['js']);
  gulp.watch(config.all_js_files, ['jshint']);
  gulp.watch(config.client_html, ['client_html', 'bs-reload']);
  gulp.watch(config.client_vendor, ['client_html', 'bs-reload']);
  gulp.watch(config.client_css, ['client_css']);
  gulp.watch(config.client_static, ['client_static', 'bs-reload']);
});

var deps = ['watch'];
if (args.debug) {
  deps.push('inspect');
}

// Depending on "watch" not because that implicitly triggers this, but
// just to start up the watcher and reprocessor, and nodemon restarts
// based on its own logic below.
gulp.task('nodemon', deps, function() {
  var options = {
    script: 'build/server/index.js',
    nodeArgs: [],
    args: ['--dev'],
    watch: ['build/server/'],
  };
  if (args.debug) {
    options.nodeArgs.push('--debug');
  }
  nodemon(options);
});

gulp.task('browser-sync', ['nodemon'], function () {

  // for more browser-sync config options: http://www.browsersync.io/docs/options/
  browser_sync({

    // informs browser-sync to proxy our expressjs app which would run at the following location
    proxy: 'http://localhost:4013',

    // informs browser-sync to use the following port for the proxied app
    // notice that the default port is 3000, which would clash with our expressjs
    port: 4000,

    // // open the proxied app in chrome
    // browser: ['google-chrome'],
  });
});

