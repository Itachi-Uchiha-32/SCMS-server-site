const dotenv = require('dotenv')
dotenv.config();
const express = require('express')
const cors = require('cors')
const admin = require("firebase-admin");

const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const Stripe = require('stripe');



const app = express();
const port = process.env.PORT || 3000;
const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
app.use(cors());
app.use(express.json());

const decodedKey = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf-8');

const serviceAccount = JSON.parse(decodedKey);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});



const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@server-site.fdkwolx.mongodb.net/?retryWrites=true&w=majority&appName=Server-site`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();
    const db = client.db('scmc-app');
    const usersCollection = db.collection('user');
    const bookingsCollection = db.collection('bookings')
    const couponsCollection = db.collection('coupons')
    const paymentsCollection = db.collection('payments');
    const announcementsCollection = db.collection('announcements');
    const reviewsCollection = db.collection('reviews');
    const eventsCollection = db.collection('events');
    // Send a ping to confirm a successful connection

    const verifyFirebase = async (req, res, next) => {
          const authHeaders = req.headers.authorization;
          if(!authHeaders){
            return res.status(401).send({message: 'unauthorized access'})
          }
          const token = authHeaders.split(' ')[1];
          if(!token){
            return res.status(401).send({message: 'unauthorized access'})
          }
    
          try{
            const decoded = await admin.auth().verifyIdToken(token);
            req.decoded = decoded;
            next();
          }
          catch(error){
            return res.status(403).send({message: 'Forbidden Access'})
          }
    
    
          // You can later verify token from req.headers.authorization here.
    
           // 🔥 This is necessary
    };

    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = {email};
      const user = await usersCollection.findOne(query);
      if(!user || user.role !== 'admin'){
        return res.status(403).send({message: 'Forbidden Access'})
      }
      next();
    }

    const verifyMember = async (req, res, next) => {
      const email = req.decoded.email;
      const query = {email};
      const user = await usersCollection.findOne(query);
      if(!user || user.role !== 'member'){
        return res.status(403).send({message: 'Forbidden Access'})
      }
      next();
    }

    app.post('/create-payment-intent', async (req, res) => {
      try {
        const { amount } = req.body; 

        const paymentIntent = await stripe.paymentIntents.create({
          amount,
          currency: 'usd', 
          payment_method_types: ['card'],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (error) {
        res.status(500).send({ error: error.message });
      }
    });

    //user api's
    app.post('/users', async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });

      if (existingUser) {
        return res.status(200).send({ message: "User already exists" });
      }

      const result = await usersCollection.insertOne(user);
      res.send(result);
    });

    app.get('/users/role/:email', async (req, res) => {
      const email = req.params.email;
      const user = await usersCollection.findOne({ email });

      res.send({ role: user?.role || "user" });
    });

    //bookings api's
    app.get('/bookings/pending/:email', verifyFirebase, async (req, res) => {
      const email = req.params.email;
      console.log("Email param:", email);

      try {
        const all = await bookingsCollection.find({}).toArray();
        console.log("All bookings:", all); 

        const result = await bookingsCollection.find({ 
          userEmail: email, 
          status: 'pending' 
        }).toArray();
        const allBookingsForUser = await bookingsCollection.find({ userEmail: email }).toArray();
        console.log("All bookings for user:", allBookingsForUser);

        console.log("Filtered bookings:", result);
        res.send(result);
      } catch (err) {
        console.error("Error fetching bookings:", err);
        res.status(500).send({ error: "Something went wrong" });
      }
    });

    app.get('/bookings/confirmed', verifyFirebase, async (req, res) => {
      try {
        const search = req.query.search || '';
        const filter = search
          ? { status: 'confirmed', courtType: { $regex: search, $options: 'i' } }
          : { status: 'confirmed' };

        const confirmed = await bookingsCollection.find(filter).toArray();
        res.send(confirmed);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch confirmed bookings', error: err.message });
      }
    });

    app.get('/bookings/pending', async (req, res) => {
      try {
        const pendingBookings = await bookingsCollection.find({ status: 'pending' }).toArray();
        res.send(pendingBookings);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch pending bookings', error: err.message });
      }
    });

    app.get('/bookings/:id', verifyFirebase, async (req, res) => {
      const { id } = req.params;
      try {
        const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });
        if (!booking) {
          return res.status(404).send({ message: 'Booking not found' });
        }
        res.send(booking);
      } catch (err) {
        res.status(500).send({ message: 'Server error', error: err.message });
      }
    });


    

    app.get('/bookings/approved/:email',verifyFirebase,  async (req, res) => {
      const email = req.params.email;
      console.log("Fetching approved bookings for:", email);

      const result = await bookingsCollection.find({
        userEmail: email,
        status: 'approved'
      }).toArray();

      res.send(result);
    });

    app.get('/bookings/confirmed/:email',verifyFirebase, verifyMember, async (req, res) => {
      const email = req.params.email;
      const confirmed = await bookingsCollection.find({
        userEmail: email,
        status: 'confirmed'
      }).toArray();
      res.send(confirmed);
    });

    

    app.patch('/bookings/approve/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid booking ID' });
      }

      try {
        const booking = await bookingsCollection.findOne({ _id: new ObjectId(id) });

        if (!booking) {
          return res.status(404).send({ message: 'Booking not found' });
        }

        const userEmail = booking.userEmail;
        if (!userEmail) {
          return res.status(400).send({ message: 'Booking has no userEmail' });
        }

        const user = await usersCollection.findOne({ email: userEmail });
        console.log('User found:', user);

        const updateFields = {
          status: 'approved',
          paymentStatus: 'unpaid',
        };

        // If user exists and not yet a member, update role and grant membership
        if (user && user.role !== 'member') {
          const membershipDate = new Date();

          await usersCollection.updateOne(
            { email: userEmail },
            {
              $set: {
                role: 'member',
                membershipGrantedDate: membershipDate,
              },
            }
          );

          updateFields.membershipGrantedDate = membershipDate;
        }

        // Update booking
        const result = await bookingsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateFields }
        );

        res.send({ message: 'Booking approved', result });

      } catch (err) {
        console.error('Error approving booking:', err);
        res.status(500).send({ message: 'Server error', error: err.message });
      }
    });


    app.delete('/bookings/:id', async (req, res) => {
      const id = req.params.id;
      const result = await bookingsCollection.deleteOne({ _id: new ObjectId(id) });
      res.send(result);
    });

    //reviews 

    app.get('/reviews', async (req, res) => {
      try {
        const reviews = await reviewsCollection
          .find({})
          .sort({ date: -1 }) 
          .toArray();
        res.send(reviews);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch reviews', error: err.message });
      }
    });

    //events
    app.get("/events", async (req, res) => {
      try {
        const events = await eventsCollection.find().toArray();
        res.json(events);
      } catch (err) {
        res.status(500).json({ message: "Failed to fetch events" });
      }
    });

    // POST new event
    app.post("/events", async (req, res) => {
      try {
        const newEvent = req.body;
        newEvent.createdAt = new Date();
        const result = await eventsCollection.insertOne(newEvent);
        res.status(201).json(result);
      } catch (err) {
        res.status(500).json({ message: "Failed to create event" });
      }
    });

    // PATCH update event by ID
    app.patch("/events/:id", async (req, res) => {
      try {
        const { id } = req.params;
        const updates = req.body;
        console.log(updates);

        const result = await eventsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updates }
        );

        if (result.matchedCount === 0) {
          return res.status(404).json({ message: "Event not found" });
        }

        res.json({ message: "Event updated successfully" });
      } catch (err) {
        res.status(500).json({ message: "Failed to update event" });
      }
    });

    //coupon
    app.get('/coupons', async (req, res) => {
      try {
        const coupons = await couponsCollection.find().toArray();
        res.send(coupons);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch coupons', error: err.message });
      }
    });

    app.post('/coupons', async (req, res) => {
      const newCoupon = req.body;
      try {
        const result = await couponsCollection.insertOne(newCoupon);
        res.status(201).send({ message: 'Coupon added successfully', id: result.insertedId });
      } catch (err) {
        res.status(500).send({ message: 'Failed to add coupon', error: err.message });
      }
    });

    app.patch('/coupons/:id', async (req, res) => {
      const { id } = req.params;
      const updateData = req.body;
      delete updateData._id;
      try {
        const result = await couponsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res.send({ message: 'Coupon updated successfully', result });
      } catch (err) {
        res.status(500).send({ message: 'Failed to update coupon', error: err.message });
      }
    });


    app.post('/validate-coupon', async (req, res) => {
      const { couponCode } = req.body;
      const coupon = await couponsCollection.findOne({ code: couponCode, status: 'active' });

      if (!coupon) {
        return res.status(400).send({ valid: false, message: 'Invalid coupon' });
      }

      res.send({
        valid: true,
        discountPercentage: coupon.discountPercentage, // e.g., 10 for 10%
      });
    });

    app.delete('/coupons/:id', async (req, res) => {
      const { id } = req.params;
      try {
        const result = await couponsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ message: 'Coupon deleted successfully', result });
      } catch (err) {
        res.status(500).send({ message: 'Failed to delete coupon', error: err.message });
      }
    });

    //payments

    app.post('/payments', async (req, res) => {
      const {
        bookingId,
        userEmail,
        amountPaid,
        couponUsed,
        paymentIntentId,
        date = new Date(),
      } = req.body;

      try {
        // Save payment record
        const result = await paymentsCollection.insertOne({
          bookingId,
          userEmail,
          amountPaid,
          couponUsed,
          paymentIntentId,
          status: 'paid',
          date,
        });

        // Update the booking status
        await bookingsCollection.updateOne(
          { _id: new ObjectId(bookingId) },
          {
            $set: {
              status: 'confirmed',
              paymentStatus: 'paid',
            },
          }
        );

        res.send({ success: true, message: 'Payment recorded and booking updated.' });
      } catch (err) {
        res.status(500).send({ success: false, message: 'Payment saving failed.', error: err.message });
      }
    });

    
    app.get('/payments/:email', async (req, res) => {
      const email = req.params.email;
      try {
        const payments = await paymentsCollection
          .find({ userEmail: email })
          .sort({ date: -1 }) // newest first
          .toArray();
        res.send(payments);
      } catch (error) {
        res.status(500).send({ error: 'Failed to fetch payment history' });
      }
    });


    //couts api
    app.post('/bookings', async (req, res) => {
      try {
        const booking = req.body;
        booking.status = 'pending';
        booking.paymentStatus = 'unpaid';

        const result = await bookingsCollection.insertOne(booking);
        res.send({ success: true, insertedId: result.insertedId });
      } catch (err) {
        res.status(500).send({ success: false, message: 'Booking failed', error: err.message });
      }
    });

    //  courts api's
    app.get('/courts/featured', async (req, res) => {
      try {
        const courts = await db.collection('courts').find({ featured: true }).toArray();
        res.send(courts);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch featured courts', error: err.message });
      }
    });

    app.get('/courts', async (req, res) => {
      try {
        const page = parseInt(req.query.page) || 1;
        const size = parseInt(req.query.size) || 6;

        const total = await db.collection('courts').countDocuments();
        const courts = await db.collection('courts')
          .find()
          .skip((page - 1) * size)
          .limit(size)
          .toArray();

        res.send({
          total,
          currentPage: page,
          totalPages: Math.ceil(total / size),
          courts,
        });
      } catch (error) {
        res.status(500).send({ message: 'Failed to fetch courts', error: error.message });
      }
    });

    app.post('/courts', async (req, res) => {
      try {
        const newCourt = req.body; // expect courtType, image, slots, price etc.
        const result = await db.collection('courts').insertOne(newCourt);
        res.status(201).send({ message: 'Court added successfully', courtId: result.insertedId });
      } catch (error) {
        res.status(500).send({ message: 'Failed to add court', error: error.message });
      }
    });

    app.patch('/courts/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid court ID' });
      }
      try {
        const updateData = req.body;
        delete updateData._id;
        console.log("PATCH /courts/:id called with id:", id);
        console.log("Update data received:", updateData);
         if (updateData.price) {
            updateData.price = Number(updateData.price);
          }
        const result = await db.collection('courts').updateOne(
          { _id: new ObjectId(id) },
          { $set: updateData }
        );
        res.send({ message: 'Court updated successfully', result });
      } catch (error) {
        res.status(500).send({ message: 'Failed to update court', error: error.message });
      }
    });

    app.delete('/courts/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid court ID' });
      }
      try {
        const result = await db.collection('courts').deleteOne({ _id: new ObjectId(id) });
        res.send({ message: 'Court deleted successfully', result });
      } catch (error) {
        res.status(500).send({ message: 'Failed to delete court', error: error.message });
      }
    });


    //announcements
    app.get('/announcements', async (req, res) => {
      try {
        const announcements = await announcementsCollection
          .find({})
          .sort({ date: -1 }) // latest first
          .toArray();
        res.send(announcements);
      } catch (error) {
        res.status(500).send({ message: 'Failed to fetch announcements', error: error.message });
      }
    });

    app.post('/announcements', async (req, res) => {
      const newAnnouncement = req.body;
      newAnnouncement.date = new Date(); 
      try {
        const result = await announcementsCollection.insertOne(newAnnouncement);
        res.status(201).send({ message: 'Announcement added successfully', insertedId: result.insertedId });
      } catch (err) {
        res.status(500).send({ message: 'Failed to add announcement', error: err.message });
      }
    });

    app.patch('/announcements/:id', async (req, res) => {
      const { id } = req.params;
      const updatedData = req.body;
      delete updatedData._id;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid ID' });
      }
      try {
        const result = await announcementsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: updatedData }
        );
        res.send({ message: 'Announcement updated successfully', result });
      } catch (err) {
        res.status(500).send({ message: 'Failed to update announcement', error: err.message });
      }
    });

    app.delete('/announcements/:id', async (req, res) => {
      const { id } = req.params;
      if (!ObjectId.isValid(id)) {
        return res.status(400).send({ message: 'Invalid ID' });
      }
      try {
        const result = await announcementsCollection.deleteOne({ _id: new ObjectId(id) });
        res.send({ message: 'Announcement deleted successfully', result });
      } catch (err) {
        res.status(500).send({ message: 'Failed to delete announcement', error: err.message });
      }
    });
    //members api's

    app.get('/members', verifyFirebase, verifyAdmin, async (req, res) => {
      try {
        
        const approvedBookings = await bookingsCollection.find({
          status: { $in: ['approved', 'confirmed'] }
        }).toArray();

        
        const uniqueEmails = [...new Set(approvedBookings.map(booking => booking.userEmail))];

        
        const members = await usersCollection.find({ email: { $in: uniqueEmails } }).toArray();

        res.send(members);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch members', error: err.message });
      }
    });
    app.get('/members/:email', async (req, res) => {
      const { email } = req.params;

      const member = await usersCollection.findOne({ email });

      if (member?.membershipGrantedDate) {
        res.send({ membershipGrantedDate: member.membershipGrantedDate });
      } else {
        res.status(404).send({ message: 'Not a member' });
      }
    });


    app.delete('/members/:email', async (req, res) => {
      const email = req.params.email;
      try {
        const result = await usersCollection.deleteOne({ email });
        res.send({ success: true, message: 'Member deleted successfully', result });
      } catch (err) {
        res.status(500).send({ message: 'Failed to delete member', error: err.message });
      }
    });

    //user api for admin
    app.get('/users',verifyFirebase, verifyAdmin, async (req, res) => {
      try {
        const search = req.query.search || '';
        const filter = search
          ? { name: { $regex: search, $options: 'i' } }
          : {};

        const users = await usersCollection.find(filter).toArray();
        res.send(users);
      } catch (err) {
        res.status(500).send({ message: 'Failed to fetch users', error: err.message });
      }
    });

    app.get('/admin/stats', verifyFirebase, async (req, res) => {
      const totalCourts = await db.collection('courts').estimatedDocumentCount();
      const totalUsers = await usersCollection.estimatedDocumentCount();
      const totalMembers = await bookingsCollection.countDocuments({ status: 'approved' });
      res.send({ totalCourts, totalUsers, totalMembers });
    });







    // await client.db("admin").command({ ping: 1 });
    // console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
    res.send("SCMC server is running")
})


app.listen(port, () => {
    console.log(`Server is running on port ${port}`)
})
