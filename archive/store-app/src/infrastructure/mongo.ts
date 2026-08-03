import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;

if (!uri && process.env.NODE_ENV !== "test") {
  console.warn("MONGODB_URI is not set");
}

declare global {
  // eslint-disable-next-line no-var
  var __mongoClientPromise: Promise<MongoClient> | undefined;
}

function createClientPromise(): Promise<MongoClient> {
  if (!uri) {
    return Promise.reject(new Error("MONGODB_URI is not configured"));
  }

  const client = new MongoClient(uri);
  return client.connect();
}

const clientPromise =
  global.__mongoClientPromise ?? createClientPromise();

if (process.env.NODE_ENV !== "production") {
  global.__mongoClientPromise = clientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await clientPromise;
  return client.db(process.env.MONGODB_DB_NAME ?? "store-work-flow");
}
