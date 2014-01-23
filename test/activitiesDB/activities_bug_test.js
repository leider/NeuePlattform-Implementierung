"use strict";

var nconf = require('../configureForTestWithDB');
var moment = require('moment-timezone');
var expect = require('chai').expect;
var sinon = require('sinon').sandbox.create();

var beans = nconf.get('beans');
var persistence = beans.get('activitiesPersistence');
var activitystore = beans.get('activitystore');
var activitiesAPI = beans.get('activitiesAPI');

var fieldHelpers = beans.get('fieldHelpers');
var Activity = beans.get('activity');

var activityUrl = 'urlOfTheActivity';


var getActivity = function (url, callback) {
  persistence.getByField({url: url}, function (err, activityState) {
    callback(err, new Activity(activityState));
  });
};

describe('Persistence', function () {

  var emptyActivity = new Activity({id: "activityId", title: 'Title of the Activity', description: 'description1', assignedGroup: 'groupname',
    location: 'location1', direction: 'direction1', startUnix: fieldHelpers.parseToUnixUsingDefaultTimezone('01.01.2013'),
    url: activityUrl, owner: 'owner', resources: {default: {_registeredMembers: [], _registrationOpen: true  }}});


  var saveActivity = function (activity, callback) {
    persistence.saveWithVersion(activity.state, callback);
  };

  beforeEach(function (done) { // if this fails, you need to start your mongo DB
    persistence.drop(function () {
      // save our sample activity
      saveActivity(emptyActivity, function (err) {
        done(err);
      });
    });
  });

  // Note: This test only shows the general mechanism of avoiding racing conditions with the help of version numbers.
  // This does not mean that the activity code already implements this!
  it('has a racing condition when updating a document twice in quick succession', function (done) {
    // load activity for the first time:
    getActivity(activityUrl, function (err, activity1) {
      // add member to loaded instance:
      activity1.resourceNamed("default").addMemberId("memberId1", moment());
      // load activity for the second time:
      getActivity(activityUrl, function (err, activity2) {
        // add member to the second instance:
        activity2.resourceNamed("default").addMemberId("memberId2", moment());
        // save first instance:
        saveActivity(activity1, function () {
          // load it again:
          getActivity(activityUrl, function (err, activity) {
            expect(activity.resourceNamed('default').registeredMembers(), "First registered member is stored").to.contain("memberId1");
            // save second instance:
            saveActivity(activity2, function (err) {
              expect(err.message).to.equal("Conflicting versions."); // Conflict is discovered
              // repeat loading and adding:
              getActivity(activityUrl, function (err, activity2) {
                activity2.resourceNamed("default").addMemberId("memberId2", moment());
                saveActivity(activity2, function () {
                  // load the resulting activity
                  getActivity(activityUrl, function (err, activity) {
                    expect(activity.resourceNamed('default').registeredMembers(), "Second registered member is stored").to.contain("memberId2");
                    // Bug #578: This expectation should work
                    expect(activity.resourceNamed('default').registeredMembers(), "First registered member is still there").to.contain("memberId1");
                    done(err);
                  });
                });
              });
            });
          });
        });
      });
    });
  });
});

describe('Activities API', function () {

  var activityWithoutRegistrant = new Activity({id: "activityId", title: 'Title of the Activity', description: 'description1', assignedGroup: 'groupname',
    location: 'location1', direction: 'direction1', startUnix: fieldHelpers.parseToUnixUsingDefaultTimezone('01.01.2013'),
    url: activityUrl, owner: 'owner', resources: {default: {_registeredMembers: [], _registrationOpen: true  }}, version: 1});

  var activityWithRegistrant = new Activity({id: "activityId", title: 'Title of the Activity', description: 'description1', assignedGroup: 'groupname',
    location: 'location1', direction: 'direction1', startUnix: fieldHelpers.parseToUnixUsingDefaultTimezone('01.01.2013'),
    url: activityUrl, owner: 'owner', resources: {default: {_registeredMembers: [
      {memberId: 'memberId1'}
    ], _registrationOpen: true  }}, version: 2});

  var invocation = 1;

  beforeEach(function (done) { // if this fails, you need to start your mongo DB

    sinon.stub(activitystore, 'getActivity', function (url, callback) {
      // on the first invocation, getActivity returns an activity without registrant to mimick a racing condition.
      if (invocation === 1) {
        invocation = 2;
        return callback(null, activityWithoutRegistrant);
      }
      // on subsequent invocations, getActivity returns an activity with registrant.
      return callback(null, activityWithRegistrant);
    });


    persistence.drop(function () {
      // save our activity with one registrant
      activitystore.saveActivity(activityWithRegistrant, function (err) {
        done(err);
      });
    });
  });

  afterEach(function () {
    sinon.restore();
  });

  it('keeps the registrant that is in the database although it only reads an activity without registrant', function (done) {
    // here, we save an activity with a member that is different from the member in the database.
    // To mimick a racing condition, we return an activity without members for the first "getActivity".
    activitiesAPI.addVisitorTo("memberId2", activityUrl, "default", moment(), function (err) {
      if (err) { return done(err); }
      getActivity(activityUrl, function (err, activity) {
        if (err) { return done(err); }
        expect(activity.resourceNamed('default').registeredMembers(), "Second registered member is stored").to.contain("memberId2");
        expect(activity.resourceNamed('default').registeredMembers(), "First registered member is still there").to.contain("memberId1");
        done(err);
      });
    });
  });


});