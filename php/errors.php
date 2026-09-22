<?php
// Thrown anywhere a route handler wants to end the request with a JSON {error} body - caught
// once in Router::dispatch(), matching the old Express routes' `res.status(n).json({error})`.

class ApiError extends RuntimeException
{
    private int $status;

    public function __construct(int $status, string $message)
    {
        parent::__construct($message);
        $this->status = $status;
    }

    public function getStatus(): int
    {
        return $this->status;
    }
}
