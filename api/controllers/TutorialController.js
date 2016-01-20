/**
 * TutorialController
 *
 * @description :: Server-side logic for managing tutorial
 * @help        :: See http://sailsjs.org/#!/documentation/concepts/Controllers
 */

module.exports = {

  searchTutorials: function(req, res) {

    Tutorial.count().exec(function(err, found){
      if (err) return res.negotiate(err);
      if (!found) return res.notFound();

      // Tutorial.find({
      //   where: {
      //     or : [
      //       {
      //         title: {
      //           'contains': req.param('searchCriteria')
      //         },
      //       },
      //       {
      //         description: {
      //           'contains': req.param('searchCriteria')
      //         }
      //       }
      //     ],
      //   },
      //   limit: 10,
      //   skip: req.param('skip')
      // });

      Tutorial.find({
        or : [
          {
            title: {
              'contains': req.param('searchCriteria')
            },
          },
          {
            description: {
              'contains': req.param('searchCriteria')
            }
          }
        ],
        limit: 10,
        skip: req.param('skip')
      })
      .populate('owner')
      // .populate('ratings') >> there could be 1,000,000 ratings--- so instead see below
      .populate('videos')
      .exec(function(err, tutorials){
        if (err) return res.negotiate(err);

        // >>>> instead of populating ratings

        // If Waterline didn't support `.average()`, or any feature for that matter,
        // or if you aren't happy with the performance, you should would fall back to the following:
        // - Talk directly to the database using `.query()` or `.native()`.  That might not work because you might need access to the raw database connection (e.g. for a transaction)
        // - Otherwise, you `require()` and use the raw driver directly (e.g. https://www.npmjs.com/package/mysql)
        // =============> Eventually, you'll be able to use the next generation of Waterline adapters directly, instead of having to fall back to using the native driver (e.g. `machinepack-mysql`)  Of course you can always use the native query.

        // Find the average rating of the tutorials we located above.
        Rating.find({
          where: {
            // This is an IN query:
            // Docs: https://github.com/balderdashy/waterline-docs/blob/master/queries/query-language.md#in-pairs
            byTutorial: _.pluck(tutorials, 'id')
            // e.g.
            // byTutorial: [3,2,83,313,1]
            
            // 
            // or:[
            //   { byTutorial: tutorials[0].id },
            //   { byTutorial: tutorials[1].id },
            //   { byTutorial: tutorials[2].id },
            //   { byTutorial: tutorials[3].id },
            //   // ..
            // ]
          }
        })
        // Docs: https://github.com/balderdashy/waterline-docs/blob/master/queries/query-methods.md#average-attribute-
        //
        // e.g. in a SQL database, this might generate something like:
        // ```
        // SELECT AVG(stars) FROM Tutorial WHERE `byTutorial` IN 3,2,83,313,1;
        // ```
        .average('stars').exec(function(err, averageStarRating) {
          if (err) return res.negotiate(err);

          // The averageStarRating comes in a little funny.
          console.log('averageStarRating: ', averageStarRating);
          try {
            averageStarRating = averageStarRating[0].stars;
          }
          catch (e) { return res.negotiate(err); }

          // Iterate through tutorials to format the owner and created attributes
          _.each(tutorials, function(tutorial){

            tutorial.owner = tutorial.owner.username;
            tutorial.created = DatetimeService.getTimeAgo({date: tutorial.createdAt});

            // Determine the total seconds for all videos and each video
            var totalSeconds = 0;
            _.each(tutorial.videos, function(video){

              // Total the number of seconds for all videos for tutorial total time
              totalSeconds = totalSeconds + video.lengthInSeconds;

            });//</each video>

            // Now format and expose the total combined play time on the
            // tutorial dictionary.
            tutorial.totalTime = DatetimeService.getHoursMinutesSeconds({totalSeconds: totalSeconds}).hoursMinutesSeconds;

            // And finally use the average rating we queried 
            tutorial.averageRating = averageStarRating;

            // See new aggregate query above
            // Format average ratings
            // var totalRating = 0;
            // _.each(tutorial.ratings, function(rating){
            //   totalRating = totalRating + rating.stars;
            // });

            // var averageRating = 0;
            // if (tutorial.ratings.length < 1) {
            //   averageRating = 0;
            // } else {
            //   averageRating = totalRating / tutorial.ratings.length;
            // }
            
            // tutorial.averageRating = averageRating;
          });//</each tutorial>

          return res.json({
            options: {
              totalTutorials: found,
              updatedTutorials: tutorials
            }
          });//</res.json>

        });
      });
    });
  },

  browseTutorials: function(req, res) {
    
    Tutorial.count().exec(function (err, numberOfTutorials){
      if (err) return res.negotiate(err);
      if (!numberOfTutorials) return res.notFound();

      Tutorial.find({
        limit: 10,
        skip: req.param('skip')
      })
      .populate('owner')
      .populate('ratings')
      .populate('videos')
      .exec(function(err, foundTutorials){

        _.each(foundTutorials, function(tutorial){

          tutorial.owner = tutorial.owner.username;
          tutorial.created = DatetimeService.getTimeAgo({date: tutorial.createdAt});

          var totalSeconds = 0;
          _.each(tutorial.videos, function(video){

            // Total the number of seconds for all videos for tutorial total time
            totalSeconds = totalSeconds + video.lengthInSeconds;

            tutorial.totalTime = DatetimeService.getHoursMinutesSeconds({totalSeconds: totalSeconds}).hoursMinutesSeconds;

            // Format average ratings
            var totalRating = 0;
            _.each(tutorial.ratings, function(rating){
              totalRating = totalRating + rating.stars;
            });

            var averageRating = 0;
            if (tutorial.ratings.length < 1) {
              averageRating = 0;
            } else {
              averageRating = totalRating / tutorial.ratings.length;
            }
            
            tutorial.averageRating = averageRating;
          });
        });

        return res.json({
          options: {
            totalTutorials: numberOfTutorials,
            updatedTutorials: foundTutorials
          }
        });
      });
    });
  },

  rateTutorial: function(req, res) {

    // Find the currently authenticated user
    User.findOne({
      id: req.session.userId
    })
    .exec(function(err, currentUser){
      if (err) return res.negotiate(err);
      if (!currentUser) return res.notFound();

      // Find the tutorial being rated
      Tutorial.findOne({
        id: +req.param('id')
      })
      .populate('owner')
      .exec(function(err, foundTutorial){
        if (err) return res.negotiate(err);
        if (!foundTutorial) return res.notFound();

        // Assure that the owner of the tutorial cannot rate their own tutorial.
        // Note that this is a back-up to the front-end which already prevents the UI from being displayed. 
        if (currentUser.id === foundTutorial.owner.id) {
          return res.forbidden();
        }

        // Find the rating, if any, of the tutorial from the currently logged in user.
        Rating.findOne({
          byUser: currentUser.id,
          byTutorial: foundTutorial.id
        }).exec(function(err, foundRating){
          if (err) return res.negotiate(err);

          // If the currently authenticated user-agent (user) has previously rated this tutorial
          // update it with the new rating.
          if (foundRating) {

            Rating.update({
              id: foundRating.id
            }).set({
              stars: req.param('stars')
            }).exec(function(err, updatedRating){
              if (err) return res.negotiate(err);
              if (!updatedRating) return res.notFound();

              // Re-Find the tutorial whose being rated to get the latest
              Tutorial.findOne({
                id: req.param('id')
              })
              .populate('ratings')
              .exec(function(err, foundTutorialAfterUpdate){
                if (err) return res.negotiate(err);
                if (!foundTutorialAfterUpdate) return res.notFound();

                return res.json({
                  averageRating: MathService.calculateAverage({ratings: foundTutorialAfterUpdate.ratings})
                });
              });
            });

          // If the currently authenticated user-agent (user) has not already rated this tutorial
          // create it with the new rating.
          } else {
            Rating.create({
              stars: req.param('stars'),
              byUser: currentUser.id,
              byTutorial: foundTutorial.id
            }).exec(function(err, createdRating){
              if (err) return res.negotiate(err);
              if (!createdRating) return res.notFound();

              // Re-Find the tutorial whose being rated to get the latest
              Tutorial.findOne({
                id: req.param('id')
              })
              .populate('ratings')
              .exec(function(err, foundTutorialAfterUpdate){
                if (err) return res.negotiate(err);
                if (!foundTutorialAfterUpdate) return res.notFound();

                return res.json({
                  averageRating: MathService.calculateAverage({ratings: foundTutorialAfterUpdate.ratings})
                });
              });
            });
          }
        });
      });
    });
  },

  // averageRating: function(req, res) {
  //   return res.json({
  //     averageRating: 3
  //   });
  // },

  createTutorial: function(req, res) {

    /*
     __   __    _ _    _      _   _          
     \ \ / /_ _| (_)__| |__ _| |_(_)___ _ _  
      \ V / _` | | / _` / _` |  _| / _ \ ' \ 
       \_/\__,_|_|_\__,_\__,_|\__|_\___/_||_|
                                         
    */
    
    if (!_.isString(req.param('title'))) {
      return res.badRequest();
    }

    if (!_.isString(req.param('description'))) {
      return res.badRequest();
    }

    // Find the user that's adding a tutorial
    User.findOne({
      id: req.session.userId
    })
    .exec(function(err, foundUser){
      if (err) return res.negotiate;
      if (!foundUser) return res.notFound();

      // Create the new tutorial in the tutorial model
      Tutorial.create({
        title: req.param('title'),
        description: req.param('description'),
        owner: foundUser.id,
        videoOrder: [],
      })
      .exec(function(err, createdTutorial){
        if (err) return res.negotiate(err);

        // return the new tutorial id
        return res.json({id: createdTutorial.id});
      });
    });
  },

  updateTutorial: function(req, res) {

    /*
     __   __    _ _    _      _   _          
     \ \ / /_ _| (_)__| |__ _| |_(_)___ _ _  
      \ V / _` | | / _` / _` |  _| / _ \ ' \ 
       \_/\__,_|_|_\__,_\__,_|\__|_\___/_||_|
                                         
    */

    // Validate parameters
    if (!_.isString(req.param('title'))) {
      return res.badRequest();
    }

    if (!_.isString(req.param('description'))) {
      return res.badRequest();
    }

    // Find the currently logged in user and her tutorials
    User.findOne({
      id: req.session.userId
    }).exec(function (err, foundUser){
      if (err) return res.negotiate(err);
      if (!foundUser) return res.notFound();

      Tutorial.findOne({
        id: +req.param('id')
      })
      .populate('owner')
      .exec(function(err, foundTutorial){
        if (err) return res.negotiate(err);
        if (!foundTutorial) return res.notFound();

        // Check ownership
        if (foundUser.id != foundTutorial.owner.id) {
          return res.forbidden();
        }

        // Update the tutorial coercing the incoming id from a string to an integer using the unary `+` 
        Tutorial.update({
          id: +req.param('id')
        }).set({
          title: req.param('title'),
          description: req.param('description')
        }).exec(function (err) {
          if (err) return res.negotiate(err);

          return res.ok();
        });
      });
    });
  },

  addVideo: function(req, res) {

    /*
     __   __    _ _    _      _   _          
     \ \ / /_ _| (_)__| |__ _| |_(_)___ _ _  
      \ V / _` | | / _` / _` |  _| / _ \ ' \ 
       \_/\__,_|_|_\__,_\__,_|\__|_\___/_||_|
                                         
    */
   
    if (!_.isNumber(req.param('hours')) || !_.isNumber(req.param('minutes')) || !_.isNumber(req.param('seconds'))) {
      return res.badRequest();
    }
    if (!_.isString(req.param('src')) || !_.isString(req.param('title'))) {
      return res.badRequest();
    }

    // Look up the tutorial record.
    Tutorial.findOne({
      id: +req.param('tutorialId')
    })
    .populate('owner')
    .exec(function (err, foundTutorial){
      if (err) return res.negotiate(err);
      if (!foundTutorial) return res.notFound();

      // Assure that the owner is the current user
      if (foundTutorial.owner.id !== req.session.userId) {
        return res.forbidden();
      }

      // Count the videos currently in this tutorial and ensure that adding a new one
      // wouldn't exceed our arbitrary limit of 25.
      var MAX_NUM_VIDEOS_PER_TUTORIAL = 25;
      // TODO

      // Create the video record.
      Video.create({
        tutorialAssoc: foundTutorial.id,
        title: req.param('title'),
        src: req.param('src'),
        lengthInSeconds: req.param('hours') * 60 * 60 + req.param('minutes') * 60 + req.param('seconds')
      }).exec(function (err, createdVideo) {
        if (err) return res.negotiate(err);

        // Modify the `videoOrder` array embedded in our tutorial to reflect the new video.
        // (We always add new videos to the bottom of the list)
        foundTutorial.videoOrder.push(createdVideo.id);

        foundTutorial.save(function (err){
          if (err) return res.negotiate(err);

          return res.ok();
        });
      });
    });
  },


  updateVideo: function(req, res) {

    /*
     __   __    _ _    _      _   _          
     \ \ / /_ _| (_)__| |__ _| |_(_)___ _ _  
      \ V / _` | | / _` / _` |  _| / _ \ ' \ 
       \_/\__,_|_|_\__,_\__,_|\__|_\___/_||_|
                                         
    */

    if (!_.isString(req.param('title'))) {
      return res.badRequest();
    }

    if (!_.isString(req.param('src'))) {
      return res.badRequest();
    }

    if (!_.isNumber(req.param('hours')) || !_.isNumber(req.param('minutes')) || !_.isNumber(req.param('seconds'))) {
      return res.badRequest();
    }
   
    // Coerce the hours, minutes, seconds parameter to integers
    var hours = +req.param('hours');
    var minutes = +req.param('minutes');
    var seconds = +req.param('seconds');

    // Calculate the total seconds of the video and store that value as lengthInSeconds
    var convertedToSeconds = hours * 60 * 60 + minutes * 60 + seconds;

    Video.findOne({
      id: +req.param('id')
    })
    .populate('tutorialAssoc')
    .exec(function (err, foundVideo){
      if (err) return res.negotiate (err);
      if (!foundVideo) return res.notFound();

      // Assure that the currently logged in user is the owner of the tutorial
      if (req.session.userId !== foundVideo.tutorialAssoc.owner) {
        return res.forbidden();
      }

      // Update the video 
      Video.update({
        id: +req.param('id')
      }).set({
        title: req.param('title'),
        src: req.param('src'),
        lengthInSeconds: convertedToSeconds
      }).exec(function (err, updatedUser){
        if (err) return res.negotiate(err);
        if (!updatedUser) return res.notFound();

        return res.ok();
      });
    });
  },

  deleteTutorial: function(req, res) {

    // Find the currently logged in user and her tutorials
    User.findOne({
      id: req.session.userId
    }).exec(function (err, foundUser){
      if (err) return res.negotiate(err);
      if (!foundUser) return res.notFound();

      Tutorial.findOne({
        id: +req.param('id')
      })
      .populate('owner')
      .populate ('ratings')
      .populate('videos')
      .exec(function(err, foundTutorial){
        if (err) return res.negotiate(err);
        if (!foundTutorial) return res.notFound();

        // Check ownership
        if (foundUser.id != foundTutorial.owner.id) {
          return res.forbidden();
        }
        
        // Destroy the tutorial
        Tutorial.destroy({
          id: req.param('id')
        }).exec(function(err){
          if (err) return res.negotiate(err);

          // Destroy videos
          Video.destroy({
            id: _.pluck(foundTutorial.videos, 'id')
          }).exec(function (err){
            if (err) return res.negotiate(err);

            // Destroy ratings
            Rating.destroy({
              id: _.pluck(foundTutorial.ratings, 'id')
            }).exec(function (err){
              if (err) return res.negotiate(err);

              // Return the username of the user using the userId of the session.
              return res.json({username: foundUser.username});
            });
          });
        });
      });
    });
  },

  removeVideo: function(req, res) {

    Tutorial.findOne({
      id: +req.param('tutorialId')
    })
    .exec(function (err, foundTutorial){
      if (err) return res.negotiate(err);
      if (!foundTutorial) return res.notFound();

      // Check ownership
      if (req.session.userId !== foundTutorial.owner) {
        return res.forbidden();
      }

      // Remove the reference to this video from our tutorial record.
      foundTutorial.videos.remove(+req.param('id'));

      // Remove this video id from the `videoOrder` array
      foundTutorial.videoOrder = _.without(foundTutorial.videoOrder, +req.param('id'));

      // Persist our tutorial back to the database.
      foundTutorial.save(function (err){
        if (err) return res.negotiate(err);
        
        Video.destroy({
          id: +req.param('id')
        }).exec(function(err){
          if (err) return res.negotiate(err);
      
          return res.ok();
        });
      });
    });
  }
};