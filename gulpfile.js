const gulp = require('gulp');
const del = require('del');
const pump = require('pump');
const copydeps = require('gulp-npm-copy-deps');
const archiver = require('archiver');
const rename = require('gulp-rename');
const sass = require('gulp-sass');
const asar = require('gulp-asar');
const fs = require('fs');

gulp.task('config', function () {
    return pump([
        gulp.src('./config.json'),
        gulp.dest('./release'),
    ]);
});

gulp.task('main', function () {
    return pump([
        gulp.src('./index.js'),
        gulp.dest('./release'),
    ]);
});

gulp.task('scss', function () {
    return pump([
        gulp.src('./index.scss'),
        gulp.dest('./release'),
    ]);
});

gulp.task('dependencies', function () {
    return copydeps('./', './release');
});

gulp.task('package', function () {
    const release_zip = archiver('zip');
    release_zip.directory('./release', '');

    const release_zip_stream = fs.createWriteStream('./release/release.zip');
    release_zip.pipe(release_zip_stream);

    release_zip.finalize();
    return release_zip;
});

gulp.task('clean', function () {
    return del(['./release/**/*']);
});

gulp.task('release', gulp.series('clean', gulp.parallel('main', 'scss', 'config', 'dependencies'), 'package'));

gulp.task('pack', gulp.series('dependencies', function () {
    return pump([
        gulp.src('src/index.scss'),
        rename('index.min.css'),
        sass({
            outputStyle: 'compressed',
        }),

        gulp.src('src/**/*.js'),
        gulp.src('config.json'),
        gulp.src('node_modules/**/*'),

        asar('discord-module-search.bd'),
        gulp.dest('dist'),
    ]);
}));
