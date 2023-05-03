const express = require('express');
const router = express.Router();
const { default: mongoose } = require('mongoose');

// mongodb user model
const { userSchema } = require('./../models/User');

// mongodb user verification model
const {
  UserVerificationSchema,
  UserVerification,
} = require('./../models/UserVerification');

// email handler
const nodemailer = require('nodemailer');

// unique string
const { v4: uuidv4 } = require('uuid');

// env variables
require('dotenv').config();

// Password handler
const bcrypt = require('bcrypt');

// path for static verified page
const path = require('path');

const passport = require('passport');
const passportLocalMongoose = require('passport-local-mongoose');
const GoogleStrategy = require('passport-google-oauth20').Strategy;
const findOrCreate = require('mongoose-findorcreate');

// mongoose.connect('mongodb://localhost:27017/userDB', { useNewUrlParser: true });

// const userSchema = new mongoose.Schema({
//   email: String,
//   password: String,
// });

userSchema.plugin(passportLocalMongoose);
// userSchema.plugin(findOrCreate);

// const secret = process.env.SECRET;

const User = new mongoose.model('User', userSchema);

passport.use(User.createStrategy());

passport.serializeUser(function (user, done) {
  done(null, user);
});

passport.deserializeUser(function (user, done) {
  done(null, user);
});

passport.use(
  new GoogleStrategy(
    {
      clientID: process.env.CLIENT_ID,
      clientSecret: process.env.CLIENT_SECRET,
      callbackURL: `http://localhost:${process.env.PORT}/auth/google/secrets`,
      userProfileURL: 'https://www.googleapis.com/oauth2/v3/userinfo',
    },
    function (accessToken, refreshToken, profile, cb) {
      console.log(profile);
      User.findOne(
        {
          email: profile.emails[0].value,
        },
        function (err, user) {
          if (err) {
            return cb(err);
          }
          // No user was found... so create a new user with values from Google
          if (!user) {
            user = new User({
              username: profile.displayName,
              email: profile.emails[0].value,
              password: profile.id,
              dateOfBirth: null,
              verified: true,
            });
            user.save(function (err) {
              if (err) console.log(err);
              return cb(err, user);
            });
          } else {
            // found user. Return
            return cb(err, user);
          }
        }
      );
    }
  )
);

// nodemailer stuff
let transporter = nodemailer.createTransport({
  service: 'outlook',
  auth: {
    user: process.env.AUTH_EMAIL,
    pass: process.env.AUTH_PASS,
  },
});

// testing success
transporter.verify((error, success) => {
  if (error) {
    console.log(error);
  } else {
    console.log('Ready for messages');
    console.log(success);
  }
});

// send verification email
const sendVerificationEmail = ({ _id, email }, res) => {
  // url to be used in the email
  const currentUrl = `http://localhost:${process.env.PORT}/`;

  const uniqueString = uuidv4() + _id;

  const mailOptions = {
    from: process.env.AUTH_EMAIL,
    to: email,
    subject: 'Verify your email',
    html: `<p> Verify your email address to complete the signup and login to your account</p>
             <p>This link <b>expires in 6 hours</b>.</p>
             <p>Press <a href=${
               currentUrl + 'verify/' + _id + '/' + uniqueString
             }>here</a> to proceed.</p>`,
  };

  // hash the uniqueString
  const saltRounds = 10;
  bcrypt
    .hash(uniqueString, saltRounds)
    .then((hashedUniqueString) => {
      // set values in userVerification collection
      const newVerification = new UserVerification({
        userId: _id,
        uniqueString: hashedUniqueString,
        createdAt: Date.now(),
        expiresAt: Date.now() + 21600000,
      });

      newVerification
        .save()
        .then(() => {
          transporter
            .sendMail(mailOptions)
            .then(() => {
              // email sent and verification record saved
              res.json({
                status: 'PENDING',
                message: 'Verification email sent!',
              });
            })
            .catch((error) => {
              console.log(error);
              res.json({
                status: 'FAILED',
                message: 'Verification email failed',
              });
            });
        })
        .catch((error) => {
          console.log(error);
          res.json({
            status: 'FAILED',
            message: "Couldn't saved verification email data!",
          });
        });
    })
    .catch(() => {
      res.json({
        status: 'FAILED',
        message: 'An error occurred while hashing email data',
      });
    });
};

router.get('/', function (req, res) {
  res.render('home');
});

router.get('/login', function (req, res) {
  res.render('login');
});

router.get('/register', function (req, res) {
  res.render('register');
});

router.get(
  '/auth/google',
  passport.authenticate('google', { scope: ['profile', 'email'] })
);

router.get(
  '/auth/google/secrets',
  passport.authenticate('google', {
    scope: ['profile', 'email'],
    failureRedirect: '/login',
  }),
  function (req, res) {
    // Successful authentication, redirect to secrets
    res.redirect('/secrets');
  }
);

router.post('/checkEmail', function (req, res) {
  console.log(req.body.email);
  User.findOne({ email: req.body.email }, function (err, foundUser) {
    if (foundUser) {
      res.send({ validity: true });
    } else {
      res.send({ validity: false });
    }
  });
});

router.get('/secrets', function (req, res) {
  if (req.isAuthenticated()) {
    res.render('secrets');
  } else {
    res.redirect('/login');
  }
});

router.get('/logout', function (req, res, next) {
  req.logout(function (err) {
    if (err) {
      return next(err);
    }
    req.session.destroy();
    res.redirect('/');
  });
});

//verify email
router.get('/verify/:userId/:uniqueString', (req, res) => {
  let { userId, uniqueString } = req.params;

  UserVerification.find({ userId })
    .then((result) => {
      if (result.length > 0) {
        // user verification record exists so we proceed

        const { expiresAt } = result[0];
        const hashedUniqueString = result[0].uniqueString;

        // checking for expired unique string
        if (expiresAt < Date.now()) {
          // record has expired so we delete it
          UserVerification.deleteOne({ userId })
            .then((result) => {
              User.deleteOne({ _id: userId })
                .then(() => {
                  let message = 'Link has expired. Please sign up again.';
                  res.redirect(`/user/verified/error=true&message=${message}`);
                })
                .catch((error) => {
                  let message =
                    'Clearing user with expired unique string failed';
                  res.redirect(`/user/verified/error=true&message=${message}`);
                });
            })
            .catch((error) => {
              console.log(error);
              let message =
                'An error occurred while clearing expired user verification record';
              res.redirect(`/user/verified/error=true&message=${message}`);
            });
        } else {
          // user verification record exists so we validate the user string
          // First compare the hashed unique string

          bcrypt
            .compare(uniqueString, hashedUniqueString)
            .then((result) => {
              if (result) {
                // string is valid
                User.updateOne({ _id: userId }, { verified: true })
                  .then(() => {
                    UserVerification.deleteOne({ userId })
                      .then(() => {
                        res.sendFile(
                          path.join(__dirname, './../views/verified.html')
                        );
                      })
                      .catch((error) => {
                        console.log(error);
                        let message =
                          'Error occurred while finalizing successful verification';
                        res.redirect(
                          `/user/verified/error=true&message=${message}`
                        );
                      });
                  })
                  .catch((error) => {
                    console.log(error);
                    let message =
                      'An error occurred while updating user record to show verified.';
                    res.redirect(
                      `/user/verified/error=true&message=${message}`
                    );
                  });
              } else {
                // existing record but incorrent verification details passed.
                let message =
                  'Invalid verification details passed. Check your inbox.';
                res.redirect(`/user/verified/error=true&message=${message}`);
              }
            })
            .catch((error) => {
              let message = 'An error occurred while comparing unique strings.';
              res.redirect(`/user/verified/error=true&message=${message}`);
            });
        }
      } else {
        // user verification record does not exist
        let message =
          'Account record does not exist or has been verified already. Please signup or login.';
        res.redirect(`/user/verified/error=true&message=${message}`);
      }
    })
    .catch((error) => {
      console.log(error);
      let message =
        'An error occurred while checking for existing user verification record';
      res.redirect(`/user/verified/error=true&message=${message}`);
    });
});

// Verified page route
router.get('/verified', (req, res) => {
  res.sendFile(path.join(__dirname, './../views/verified.html'));
});

// signin
router.post('/login', (req, res) => {
  let { username, password } = req.body;
  email = username.trim();
  password = password.trim();

  if (email == '' || password == '') {
    res.json({
      status: 'FAILED',
      message: 'Empty credentials supplied',
    });
  } else {
    // Check if user exists
    User.find({ email })
      .then((data) => {
        console.log(data);
        if (data.length) {
          // user exists

          // check if user is verified

          if (!data[0].verified) {
            res.json({
              status: 'FAILED',
              message: "Email hasn't been verified yet. Check your inbox",
            });
          } else {
            const hashedPassword = data[0].password;
            bcrypt
              .compare(password, hashedPassword)
              .then((result) => {
                if (result) {
                  console.log('Password matches!');
                  //password match
                  // res.json({
                  //   status: 'SUCCESS',
                  //   message: 'Signin successfull',
                  //   data: data,
                  // });

                  console.log('Trying to authenticate');
                  passport.authenticate('local')(req, res, function () {
                    res.redirect('/secrets');
                  });
                  // passport.authenticate('local', {
                  //   failureRedirect: '/login',
                  //   failureMessage: true,
                  // }),
                  //   function (req, res) {
                  //     res.redirect('/secrets');
                  //   };
                } else {
                  res.json({
                    status: 'FAILED',
                    message: 'Invalid password entered!',
                    data: data,
                  });
                }
              })
              .catch((err) => {
                res.json({
                  status: 'FAILED',
                  message: 'An error occurred while comparing passwords',
                  data: data,
                  error: err,
                });
              });
          }
        } else {
          res.json({
            status: 'FAILED',
            message: 'Invalid credentials entered.',
            data: data,
          });
        }
      })
      .catch((err) => {
        res.json({
          status: 'FAILED',
          message: 'An error occurred while checking for existing user',
          data: data,
        });
      });
  }
});

// signup
router.post('/register', (req, res) => {
  console.log(req.body);
  let { name, username, password, dob } = req.body;
  name = name.trim();
  email = username.trim();
  password = password.trim();
  dateOfBirth = dob.trim();

  if (name == '' || email == '' || password == '' || dateOfBirth == '') {
    res.json({
      status: 'FAILED',
      message: 'Empty input fields!',
    });
  } else if (!/^[a-zA-Z ]*$/.test(name)) {
    res.json({
      status: 'FAILED',
      message: 'Invalid name entered',
    });
  } else if (!/^[\w-\.]+@([\w-]+\.)+[\w-]{2,4}$/.test(email)) {
    res.json({
      status: 'FAILED',
      message: 'Invalid email entered',
    });
  } else if (!new Date(dateOfBirth).getTime()) {
    res.json({
      status: 'FAILED',
      message: 'Invalid date of birth entered',
    });
  } else if (password.length < 8) {
    res.json({
      status: 'FAILED',
      message: 'Password is too short',
    });
  } else {
    // Checking if user already exists
    User.find({ email }).then((result) => {
      if (result.length) {
        // A user already exists
        res.json({
          status: 'FAILED',
          message: 'User with the provided email already exists',
        });
      } else {
        // Try to create a new user

        // password handling
        const saltRounds = 10;
        bcrypt
          .hash(password, saltRounds)
          .then((hashedPassword) => {
            const newUser = new User({
              name: name,
              email: email,
              password: hashedPassword,
              dateOfBirth: dateOfBirth,
              verified: false,
            });

            newUser
              .save()
              .then((result) => {
                // handle account verification
                sendVerificationEmail(result, res);
              })
              .catch((err) => {
                res.json({
                  status: 'FAILED',
                  message: `An error occurred while saving user account: ${err}`,
                });
              });
          })
          .catch((err) => {
            res.json({
              status: 'FAILED',
              message: 'An error occurred while hashing password!',
            });
          });
      }
    });
  }
});

module.exports = router;
